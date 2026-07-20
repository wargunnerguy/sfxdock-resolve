// The SQLite-backed local library: deliberate downloads (rich metadata) plus
// filename-indexed watched folders. Built on node:sqlite (see CLAUDE.md /
// docs/phase0-audit.md — no native module, no ABI-rebuild risk).
//
// Runs entirely outside Resolve and is unit-tested against :memory: DBs.

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import type { ContentType } from '../providers/core/types';
import { MIGRATIONS, SCHEMA_VERSION } from './schema';
import { isAudioFile, formatOf, readDurationSec } from './audio-meta';
import { searchText, tokenize } from './tokenize';
import type {
    DownloadRecord,
    LocalIndex,
    LocalSearchHit,
    NewDownload,
    WatchedFolder,
} from './types';

interface DownloadRow {
    id: number;
    provider_id: string;
    source_id: string;
    title: string;
    author: string | null;
    license_id: string;
    license_name: string;
    license_url: string | null;
    attribution: string;
    attribution_required: number;
    tags: string;
    original_query: string;
    file_path: string;
    duration_sec: number;
    format: string;
    content_type: string;
    downloaded_at: number;
}

export interface RescanResult {
    added: number;
    removed: number;
    scannedFolders: number;
}

export class Library implements LocalIndex {
    private db: DatabaseSync;

    constructor(dbPath: string) {
        this.db = new DatabaseSync(dbPath);
        this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
        this.migrate();
    }

    private migrate(): void {
        const row = this.db.prepare('PRAGMA user_version').get() as { user_version: number };
        let version = row.user_version;
        for (let v = version; v < MIGRATIONS.length; v++) {
            this.db.exec(MIGRATIONS[v]!);
        }
        version = MIGRATIONS.length;
        // user_version can't be parameterized; value is an internal constant.
        this.db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    }

    close(): void {
        this.db.close();
    }

    // ---- downloads ----

    /** Registers the pre-existing folder as non-removable and creates it on disk. */
    ensureDownloadsFolder(dir: string): void {
        fs.mkdirSync(dir, { recursive: true });
        const existing = this.db.prepare('SELECT id FROM watched_folders WHERE path = ?').get(dir);
        if (!existing) {
            this.db
                .prepare('INSERT INTO watched_folders (path, removable, added_at) VALUES (?, 0, ?)')
                .run(dir, Date.now());
        }
    }

    isOwned(providerId: string, sourceId: string): boolean {
        const row = this.db
            .prepare('SELECT 1 FROM downloads WHERE provider_id = ? AND source_id = ?')
            .get(providerId, sourceId);
        return row !== undefined;
    }

    getDownloadBySource(providerId: string, sourceId: string): DownloadRecord | null {
        const row = this.db
            .prepare('SELECT * FROM downloads WHERE provider_id = ? AND source_id = ?')
            .get(providerId, sourceId) as unknown as DownloadRow | undefined;
        return row ? this.mapDownload(row) : null;
    }

    recordDownload(entry: NewDownload): DownloadRecord {
        const now = Date.now();
        this.db
            .prepare(
                `INSERT INTO downloads
                 (provider_id, source_id, title, author, license_id, license_name, license_url,
                  attribution, attribution_required, tags, original_query, file_path,
                  duration_sec, format, content_type, downloaded_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT (provider_id, source_id) DO UPDATE SET
                   file_path = excluded.file_path,
                   attribution = excluded.attribution,
                   downloaded_at = excluded.downloaded_at`,
            )
            .run(
                entry.providerId,
                entry.sourceId,
                entry.title,
                entry.author,
                entry.licenseId,
                entry.licenseName,
                entry.licenseUrl,
                entry.attribution,
                entry.attributionRequired ? 1 : 0,
                entry.tags,
                entry.originalQuery,
                entry.filePath,
                entry.durationSec,
                entry.format,
                entry.contentType,
                now,
            );
        return this.getDownloadBySource(entry.providerId, entry.sourceId)!;
    }

    /** All downloads that require attribution (project-agnostic). */
    attributions(): DownloadRecord[] {
        const rows = this.db
            .prepare('SELECT * FROM downloads WHERE attribution_required = 1 ORDER BY downloaded_at')
            .all() as unknown as DownloadRow[];
        return rows.map((r) => this.mapDownload(r));
    }

    // ---- per-project imports (attribution export) ----

    recordImport(projectId: string, downloadId: number): void {
        this.db
            .prepare('INSERT OR IGNORE INTO imports (project_id, download_id, imported_at) VALUES (?, ?, ?)')
            .run(projectId, downloadId, Date.now());
    }

    /** Downloads imported into a given Resolve project, in import order. */
    importsForProject(projectId: string): DownloadRecord[] {
        const rows = this.db
            .prepare(
                `SELECT d.* FROM downloads d
                 JOIN imports i ON i.download_id = d.id
                 WHERE i.project_id = ?
                 ORDER BY i.imported_at`,
            )
            .all(projectId) as unknown as DownloadRow[];
        return rows.map((r) => this.mapDownload(r));
    }

    // ---- watched folders ----

    listWatchedFolders(): WatchedFolder[] {
        const rows = this.db
            .prepare('SELECT * FROM watched_folders ORDER BY removable, added_at')
            .all() as unknown as Array<{ id: number; path: string; removable: number; added_at: number }>;
        return rows.map((r) => ({ id: r.id, path: r.path, removable: r.removable === 1, addedAt: r.added_at }));
    }

    addWatchedFolder(dir: string): WatchedFolder | null {
        if (!fs.existsSync(dir)) return null;
        const existing = this.db.prepare('SELECT id FROM watched_folders WHERE path = ?').get(dir);
        if (existing) return null;
        this.db.prepare('INSERT INTO watched_folders (path, removable, added_at) VALUES (?, 1, ?)').run(dir, Date.now());
        return this.listWatchedFolders().find((f) => f.path === dir) ?? null;
    }

    /** Removes a watched folder (never the non-removable downloads folder) and its indexed files. */
    removeWatchedFolder(id: number): boolean {
        const row = this.db.prepare('SELECT removable FROM watched_folders WHERE id = ?').get(id) as
            | { removable: number }
            | undefined;
        if (!row || row.removable === 0) return false;
        this.db.prepare('DELETE FROM watched_folders WHERE id = ?').run(id);
        return true;
    }

    /** Re-index every watched folder from scratch (manual Rescan — no watchers in v1). */
    rescan(): RescanResult {
        const folders = this.listWatchedFolders();
        let added = 0;
        let removed = 0;
        for (const folder of folders) {
            const before = (
                this.db.prepare('SELECT COUNT(*) n FROM local_files WHERE folder_id = ?').get(folder.id) as {
                    n: number;
                }
            ).n;
            this.db.prepare('DELETE FROM local_files WHERE folder_id = ?').run(folder.id);
            removed += before;
            for (const filePath of walkAudioFiles(folder.path)) {
                const filename = path.basename(filePath);
                // Index the name stem only — the extension lives in `format`, so
                // searching "wav" doesn't spuriously match every wav's name.
                const stem = path.basename(filePath, path.extname(filePath));
                this.db
                    .prepare(
                        `INSERT OR IGNORE INTO local_files (folder_id, file_path, filename, search_text, duration_sec, format)
                         VALUES (?, ?, ?, ?, ?, ?)`,
                    )
                    .run(
                        folder.id,
                        filePath,
                        filename,
                        searchText(stem),
                        readDurationSec(filePath),
                        formatOf(filePath),
                    );
                added++;
            }
        }
        return { added, removed, scannedFolders: folders.length };
    }

    // ---- local search (LocalIndex) ----

    searchLocal(query: string, contentType?: ContentType): LocalSearchHit[] {
        const tokens = tokenize(query);
        const hits: LocalSearchHit[] = [];
        const seenPaths = new Set<string>();

        // Downloads first (rich metadata); respect the content-type filter.
        const downloadRows = this.db.prepare('SELECT * FROM downloads').all() as unknown as DownloadRow[];
        for (const row of downloadRows) {
            if (contentType && row.content_type !== contentType) continue;
            const hay = searchText(row.title, row.author, row.tags, row.original_query);
            if (!tokens.every((t) => hay.includes(t))) continue;
            seenPaths.add(row.file_path);
            hits.push({
                soundId: `${row.provider_id}:${row.source_id}`,
                title: row.title,
                author: row.author,
                durationSec: row.duration_sec,
                format: row.format,
                filePath: row.file_path,
                license: row.license_url ?? '',
                licenseName: row.license_name,
                attribution: row.attribution,
                attributionRequired: row.attribution_required === 1,
            });
        }

        // Watched-folder files: type unknown at filename level, so they match
        // every content-type filter. Skip any that a download already covers.
        const localRows = this.db.prepare('SELECT * FROM local_files').all() as unknown as Array<{
            id: number;
            file_path: string;
            filename: string;
            search_text: string;
            duration_sec: number | null;
            format: string;
        }>;
        for (const row of localRows) {
            if (seenPaths.has(row.file_path)) continue;
            if (!tokens.every((t) => row.search_text.includes(t))) continue;
            hits.push({
                soundId: `file:${row.id}`,
                title: row.filename,
                author: null,
                durationSec: row.duration_sec ?? 0,
                format: row.format,
                filePath: row.file_path,
                license: '',
                licenseName: 'Local file',
                attribution: row.filename,
                attributionRequired: false,
            });
        }
        return hits;
    }

    private mapDownload(row: DownloadRow): DownloadRecord {
        return {
            id: row.id,
            providerId: row.provider_id,
            sourceId: row.source_id,
            title: row.title,
            author: row.author,
            licenseId: row.license_id,
            licenseName: row.license_name,
            licenseUrl: row.license_url,
            attribution: row.attribution,
            attributionRequired: row.attribution_required === 1,
            tags: row.tags,
            originalQuery: row.original_query,
            filePath: row.file_path,
            durationSec: row.duration_sec,
            format: row.format,
            contentType: row.content_type as ContentType,
            downloadedAt: row.downloaded_at,
        };
    }
}

// Recursive audio-file walk. Skips unreadable dirs so one bad folder can't
// break a rescan.
function walkAudioFiles(root: string): string[] {
    const out: string[] = [];
    const stack = [root];
    while (stack.length > 0) {
        const dir = stack.pop()!;
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                stack.push(full);
            } else if (entry.isFile() && isAudioFile(full)) {
                out.push(full);
            }
        }
    }
    return out;
}
