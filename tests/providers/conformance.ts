// Provider contract conformance suite. Every provider must pass this
// (CLAUDE.md architecture rule). Call it from the provider's own test file
// with a context whose fetch is mocked — conformance tests never hit the
// network and never contain credentials.

import { describe, expect, it } from 'vitest';
import type { Provider, ProviderContext, RawSoundResult } from '../../src/providers/core/types';

export interface ConformanceSetup {
    provider: Provider;
    /** Context that makes search() succeed with at least one result. */
    ctx: ProviderContext;
    /** Query that yields at least one result under the mocked ctx. */
    query: string;
}

const AUTH_TYPES = ['none', 'apiKey', 'oauth2'];

export function describeProviderConformance(setup: () => ConformanceSetup): void {
    describe('provider contract conformance', () => {
        it('declares valid metadata', () => {
            const { provider } = setup();
            expect(provider.id).toMatch(/^[a-z][a-z0-9-]*$/);
            expect(provider.displayName.trim()).not.toBe('');
            expect(() => new URL(provider.homepageUrl)).not.toThrow();
            expect(AUTH_TYPES).toContain(provider.authType);
            expect(AUTH_TYPES).toContain(provider.downloadAuthType);
        });

        it('search() returns normalized results without badge logic', async () => {
            const { provider, ctx, query } = setup();
            const results = await provider.search(query, {}, ctx);
            expect(Array.isArray(results)).toBe(true);
            expect(results.length).toBeGreaterThan(0);
            for (const r of results) {
                expect(r.providerId).toBe(provider.id);
                expect(typeof r.soundId).toBe('string');
                expect(r.soundId).not.toBe('');
                expect(r.title.trim()).not.toBe('');
                expect(Number.isFinite(r.durationSec)).toBe(true);
                expect(r.durationSec).toBeGreaterThan(0);
                expect(r.license).not.toBe('');
                expect(r.previewUrl).toMatch(/^(https?|file):/);
                if (r.waveform.type === 'provided') {
                    expect(() => new URL(r.waveform.type === 'provided' ? r.waveform.url : '')).not.toThrow();
                } else {
                    expect(r.waveform.type).toBe('render');
                }
                // Badges are derived centrally in core — providers must not set them.
                expect('badge' in r).toBe(false);
            }
        });

        it('licenseInfo() yields a usable attribution for every result', async () => {
            const { provider, ctx, query } = setup();
            const results = await provider.search(query, {}, ctx);
            for (const r of results) {
                const info = provider.licenseInfo(r);
                expect(info.id).not.toBe('');
                expect(info.name).not.toBe('');
                expect(typeof info.attributionRequired).toBe('boolean');
                expect(info.attribution).toContain(r.title);
            }
        });

        it('getDownload() returns null or a valid descriptor', async () => {
            const { provider, ctx, query } = setup();
            const results = await provider.search(query, {}, ctx);
            const first = results[0] as RawSoundResult;
            const dl = await provider.getDownload(first, ctx);
            if (dl !== null) {
                expect(dl.url).toMatch(/^(https?|file):/);
                expect(AUTH_TYPES).toContain(dl.requiredAuth);
            }
        });
    });
}
