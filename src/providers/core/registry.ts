// Provider registry: register a provider here (one line) and it participates
// in every search. searchAll never rejects — per-provider failures come back
// as structured errors so one broken provider can't sink the merged results.

import { deriveBadge } from './badges';
import { ProviderError, type ProviderErrorKind } from './errors';
import type { Provider, ProviderContext, SearchOptions, SoundResult } from './types';

export interface ProviderFailure {
    providerId: string;
    kind: ProviderErrorKind;
    message: string;
}

export interface MergedSearchResult {
    results: SoundResult[];
    errors: ProviderFailure[];
}

export class ProviderRegistry {
    private providers = new Map<string, Provider>();

    register(provider: Provider): void {
        if (this.providers.has(provider.id)) {
            throw new Error(`Provider id already registered: ${provider.id}`);
        }
        this.providers.set(provider.id, provider);
    }

    get(id: string): Provider | undefined {
        return this.providers.get(id);
    }

    all(): Provider[] {
        return [...this.providers.values()];
    }

    async searchAll(
        query: string,
        options: SearchOptions,
        ctxFor: (provider: Provider) => ProviderContext,
    ): Promise<MergedSearchResult> {
        const merged: MergedSearchResult = { results: [], errors: [] };
        const active = this.all().filter(
            (p) => !options.contentType || p.contentTypes.includes(options.contentType),
        );
        const settled = await Promise.allSettled(
            active.map(async (provider) => {
                const ctx = ctxFor(provider);
                const raw = await provider.search(query, options, ctx);
                return raw.map<SoundResult>((r) => ({ ...r, badge: deriveBadge(provider, ctx) }));
            }),
        );
        active.forEach((provider, i) => {
            const outcome = settled[i];
            if (!outcome) return;
            if (outcome.status === 'fulfilled') {
                merged.results.push(...outcome.value);
            } else {
                const e: unknown = outcome.reason;
                merged.errors.push({
                    providerId: provider.id,
                    kind: e instanceof ProviderError ? e.kind : 'provider',
                    message: e instanceof Error ? e.message : String(e),
                });
            }
        });
        return merged;
    }
}
