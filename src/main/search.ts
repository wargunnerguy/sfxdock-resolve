// Provider registration + search orchestration for the main process.
// Adding a remote provider to SFXDock = one import + one register() call here.

import path from 'node:path';
import { app } from 'electron';
import { ProviderRegistry } from '../providers/core/registry';
import type { ContentType, Provider, ProviderContext, SoundResult } from '../providers/core/types';
import { freesoundProvider } from '../providers/freesound';
import { jamendoProvider } from '../providers/jamendo';
import { createLocalProvider, LOCAL_PROVIDER_ID } from '../providers/local';
import { Library } from '../library/library';
import type { PreviewCache } from './preview-cache';
import { settings } from './settings';
import { downloadSound } from './downloads';
import type { DownloadOutcome, SearchResponse } from '../shared/ipc';

export const registry = new ProviderRegistry();
let library: Library;
let downloadsDir: string;

export function initSearch(): { library: Library; downloadsDir: string } {
    downloadsDir = path.join(app.getPath('documents'), 'SFXDock');
    library = new Library(path.join(app.getPath('userData'), 'library.db'));
    library.ensureDownloadsFolder(downloadsDir);

    registry.register(freesoundProvider);
    registry.register(jamendoProvider);
    registry.register(createLocalProvider(library));
    return { library, downloadsDir };
}

function ctxFor(provider: Provider): ProviderContext {
    return {
        apiKey: settings.getProviderKey(provider.id),
        hasOAuth: false, // Phase 6
        fetch,
    };
}

export async function runSearch(
    query: string,
    contentType: ContentType | undefined,
    cache: PreviewCache,
): Promise<SearchResponse> {
    const owned = (providerId: string, soundId: string) =>
        providerId === LOCAL_PROVIDER_ID || library.isOwned(providerId, soundId);
    const merged = await registry.searchAll(query, { limit: 30, contentType }, ctxFor, owned);

    // Library-first: Owned results (local + already-downloaded) above remote ones.
    merged.results.sort((a, b) => (a.badge === 'owned' ? 0 : 1) - (b.badge === 'owned' ? 0 : 1));

    // Attach a localPath to results already on disk so the renderer can drag them out.
    for (const r of merged.results) {
        if (r.providerId === LOCAL_PROVIDER_ID) {
            r.extra = { ...r.extra, localPath: r.extra?.['filePath'] };
        } else if (r.badge === 'owned') {
            const rec = library.getDownloadBySource(r.providerId, r.soundId);
            if (rec) r.extra = { ...r.extra, localPath: rec.filePath };
        }
    }

    cache.registerPreviewUrls(merged.results);
    void cache.prefetch(merged.results.filter((r) => r.providerId !== LOCAL_PROVIDER_ID));
    return merged;
}

export interface LocalFileResult {
    status: 'ok' | 'login-required' | 'error';
    filePath?: string;
    downloadId?: number;
    message?: string;
}

/** Resolves a sound to an on-disk file, downloading it first if needed and allowed. */
export async function ensureLocalFile(sound: SoundResult, query: string): Promise<LocalFileResult> {
    if (sound.providerId === LOCAL_PROVIDER_ID) {
        const fp = sound.extra?.['filePath'] as string | undefined;
        return fp ? { status: 'ok', filePath: fp } : { status: 'error', message: 'Local file path missing' };
    }
    const existing = library.getDownloadBySource(sound.providerId, sound.soundId);
    if (existing) return { status: 'ok', filePath: existing.filePath, downloadId: existing.id };

    const outcome = await download(sound, query);
    if (outcome.status === 'ok' || outcome.status === 'already-owned') {
        const rec = library.getDownloadBySource(sound.providerId, sound.soundId);
        return rec
            ? { status: 'ok', filePath: rec.filePath, downloadId: rec.id }
            : { status: 'error', message: 'Download record missing after download' };
    }
    if (outcome.status === 'login-required') return { status: 'login-required', message: outcome.message };
    return { status: 'error', message: 'message' in outcome ? outcome.message : 'Download failed' };
}

export function getLibrary(): Library {
    return library;
}

export async function download(sound: SoundResult, query: string): Promise<DownloadOutcome> {
    const provider = registry.get(sound.providerId);
    if (!provider) return { status: 'error', message: `Unknown provider: ${sound.providerId}` };
    return downloadSound(sound, query, provider, ctxFor(provider), library, downloadsDir);
}

export function attributionFor(sound: SoundResult): string {
    const provider = registry.get(sound.providerId);
    if (!provider) return sound.title;
    return provider.licenseInfo(sound).attribution;
}
