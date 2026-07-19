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

    cache.registerPreviewUrls(merged.results);
    void cache.prefetch(merged.results.filter((r) => r.providerId !== LOCAL_PROVIDER_ID));
    return merged;
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
