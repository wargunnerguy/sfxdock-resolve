// Preview cache, implementing the locked CLAUDE.md policy: bounded disk
// cache in the app-cache dir keyed by provider+soundId, LRU eviction with a
// 200 MB cap, ~30 min TTL sweep, full wipe on app start (quit may be
// force-exited, so wiping at startup guarantees the wipe-on-quit intent),
// NEVER evicted on search change. Prefetch only the first few results.
// Streaming comes first: cache misses proxy the remote stream to the player
// while a tee'd branch fills the cache in the background.

import { app } from 'electron';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const MAX_BYTES = 200 * 1024 * 1024;
const TTL_MS = 30 * 60 * 1000;
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
const PREFETCH_COUNT = 6;

interface Entry {
    file: string;
    size: number;
    lastAccess: number;
}

export class PreviewCache {
    private dir: string;
    private index = new Map<string, Entry>();
    private remoteUrls = new Map<string, string>();
    private inFlight = new Set<string>();

    constructor(dir?: string) {
        this.dir = dir ?? path.join(app.getPath('userData'), 'preview-cache');
    }

    init(): void {
        fs.rmSync(this.dir, { recursive: true, force: true });
        fs.mkdirSync(this.dir, { recursive: true });
        const sweeper = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS);
        sweeper.unref?.();
    }

    private key(providerId: string, soundId: string): string {
        return `${providerId}_${soundId}`.replace(/[^a-zA-Z0-9_-]/g, '_');
    }

    /** Called after every search so the protocol handler can resolve ids to URLs. */
    registerPreviewUrls(results: Array<{ providerId: string; soundId: string; previewUrl: string }>): void {
        for (const r of results) {
            this.remoteUrls.set(this.key(r.providerId, r.soundId), r.previewUrl);
        }
    }

    /** Serves sfx-preview://<providerId>/<soundId> requests. */
    async handleRequest(providerId: string, soundId: string): Promise<Response> {
        const key = this.key(providerId, soundId);

        const remote = this.remoteUrls.get(key);

        // Local Folders previews are already on disk — stream directly, no cache.
        if (remote && remote.startsWith('file:')) {
            return streamLocalFile(remote);
        }

        const entry = this.index.get(key);
        if (entry) {
            entry.lastAccess = Date.now();
            const stream = Readable.toWeb(fs.createReadStream(entry.file)) as ReadableStream;
            return new Response(stream, {
                headers: { 'Content-Type': 'audio/mpeg', 'Content-Length': String(entry.size) },
            });
        }

        if (!remote) return new Response('Unknown preview id', { status: 404 });

        let upstream: Response;
        try {
            upstream = await fetch(remote);
        } catch {
            return new Response('Preview host unreachable', { status: 502 });
        }
        if (!upstream.ok || !upstream.body) {
            return new Response('Preview unavailable', { status: 502 });
        }

        const [play, store] = upstream.body.tee();
        void this.store(key, store);
        return new Response(play, {
            headers: { 'Content-Type': upstream.headers.get('Content-Type') ?? 'audio/mpeg' },
        });
    }

    /** Warm the cache for the first visible results only (rate-limit safety). */
    async prefetch(results: Array<{ providerId: string; soundId: string; previewUrl: string }>): Promise<void> {
        for (const r of results.slice(0, PREFETCH_COUNT)) {
            const key = this.key(r.providerId, r.soundId);
            if (this.index.has(key) || this.inFlight.has(key)) continue;
            try {
                const resp = await fetch(r.previewUrl);
                if (resp.ok && resp.body) await this.store(key, resp.body);
            } catch {
                // prefetch is best-effort
            }
        }
    }

    private async store(key: string, body: ReadableStream): Promise<void> {
        if (this.inFlight.has(key)) return;
        this.inFlight.add(key);
        const tmp = path.join(this.dir, `${key}.part`);
        const final = path.join(this.dir, key);
        try {
            await pipeline(Readable.fromWeb(body as never), fs.createWriteStream(tmp));
            const size = (await fsp.stat(tmp)).size;
            await fsp.rename(tmp, final);
            this.index.set(key, { file: final, size, lastAccess: Date.now() });
            this.enforceCap();
        } catch {
            await fsp.rm(tmp, { force: true }).catch(() => undefined);
        } finally {
            this.inFlight.delete(key);
        }
    }

    private enforceCap(): void {
        let total = [...this.index.values()].reduce((n, e) => n + e.size, 0);
        if (total <= MAX_BYTES) return;
        const byOldest = [...this.index.entries()].sort((a, b) => a[1].lastAccess - b[1].lastAccess);
        for (const [key, entry] of byOldest) {
            if (total <= MAX_BYTES) break;
            this.index.delete(key);
            total -= entry.size;
            fsp.rm(entry.file, { force: true }).catch(() => undefined);
        }
    }

    private sweep(): void {
        const cutoff = Date.now() - TTL_MS;
        for (const [key, entry] of this.index) {
            if (entry.lastAccess < cutoff) {
                this.index.delete(key);
                fsp.rm(entry.file, { force: true }).catch(() => undefined);
            }
        }
    }
}

const AUDIO_MIME: Record<string, string> = {
    wav: 'audio/wav',
    mp3: 'audio/mpeg',
    ogg: 'audio/ogg',
    flac: 'audio/flac',
    m4a: 'audio/mp4',
    aac: 'audio/aac',
    opus: 'audio/opus',
    aif: 'audio/aiff',
    aiff: 'audio/aiff',
};

function streamLocalFile(fileUrl: string): Response {
    let filePath: string;
    try {
        filePath = fileURLToPath(fileUrl);
    } catch {
        return new Response('Bad file url', { status: 400 });
    }
    if (!fs.existsSync(filePath)) return new Response('File not found', { status: 404 });
    const ext = filePath.slice(filePath.lastIndexOf('.') + 1).toLowerCase();
    const stream = Readable.toWeb(fs.createReadStream(filePath)) as ReadableStream;
    return new Response(stream, { headers: { 'Content-Type': AUDIO_MIME[ext] ?? 'application/octet-stream' } });
}
