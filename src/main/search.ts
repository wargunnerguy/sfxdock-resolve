// Provider registration + search orchestration for the main process.
// Adding a provider to SFXDock = one import + one register() call here.

import { ProviderRegistry } from '../providers/core/registry';
import type { Provider, ProviderContext } from '../providers/core/types';
import { freesoundProvider } from '../providers/freesound';
import type { PreviewCache } from './preview-cache';
import { settings } from './settings';
import type { SearchResponse } from '../shared/ipc';

export const registry = new ProviderRegistry();
registry.register(freesoundProvider);

function ctxFor(provider: Provider): ProviderContext {
    return {
        apiKey: settings.getProviderKey(provider.id),
        hasOAuth: false, // Phase 6
        fetch,
    };
}

export async function runSearch(query: string, cache: PreviewCache): Promise<SearchResponse> {
    const merged = await registry.searchAll(query, { limit: 30 }, ctxFor);
    cache.registerPreviewUrls(merged.results);
    void cache.prefetch(merged.results);
    return merged;
}
