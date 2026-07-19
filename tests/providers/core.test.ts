import { describe, expect, it } from 'vitest';
import { deriveBadge } from '../../src/providers/core/badges';
import { ccLicenseFromUrl } from '../../src/providers/core/licenses';
import { ProviderRegistry } from '../../src/providers/core/registry';
import { ProviderAuthError } from '../../src/providers/core/errors';
import type { Provider, ProviderContext, RawSoundResult } from '../../src/providers/core/types';

const baseCtx: ProviderContext = { apiKey: 'k', hasOAuth: false, fetch };

function stubProvider(overrides: Partial<Provider> = {}): Provider {
    return {
        id: 'stub',
        displayName: 'Stub',
        homepageUrl: 'https://example.com',
        authType: 'none',
        downloadAuthType: 'none',
        search: async () => [
            {
                providerId: overrides.id ?? 'stub',
                soundId: '1',
                title: 'Test',
                durationSec: 1,
                license: 'test',
                previewUrl: 'https://example.com/a.mp3',
                waveform: { type: 'render' },
            } satisfies RawSoundResult,
        ],
        getDownload: async () => null,
        licenseInfo: () => ({
            id: 'test',
            name: 'Test',
            attribution: 'Test',
            attributionRequired: false,
        }),
        ...overrides,
    };
}

describe('badge derivation', () => {
    it('owned wins over everything', () => {
        const p = stubProvider({ downloadAuthType: 'oauth2' });
        expect(deriveBadge(p, baseCtx, { owned: true, paid: true })).toBe('owned');
    });
    it('paid beats login-required', () => {
        const p = stubProvider({ downloadAuthType: 'oauth2' });
        expect(deriveBadge(p, baseCtx, { paid: true })).toBe('paid');
    });
    it('oauth2 download without oauth means login-required', () => {
        const p = stubProvider({ downloadAuthType: 'oauth2' });
        expect(deriveBadge(p, baseCtx)).toBe('login-required');
        expect(deriveBadge(p, { ...baseCtx, hasOAuth: true })).toBe('free');
    });
    it('apiKey download without key means login-required', () => {
        const p = stubProvider({ downloadAuthType: 'apiKey' });
        expect(deriveBadge(p, { ...baseCtx, apiKey: null })).toBe('login-required');
        expect(deriveBadge(p, baseCtx)).toBe('free');
    });
});

describe('cc license mapping', () => {
    it('maps CC0', () => {
        expect(ccLicenseFromUrl('http://creativecommons.org/publicdomain/zero/1.0/')).toMatchObject({
            id: 'CC0-1.0',
            attributionRequired: false,
        });
    });
    it('maps versioned CC-BY and CC-BY-NC', () => {
        expect(ccLicenseFromUrl('https://creativecommons.org/licenses/by/4.0/')).toMatchObject({ id: 'CC-BY-4.0' });
        expect(ccLicenseFromUrl('http://creativecommons.org/licenses/by-nc/3.0/')).toMatchObject({ id: 'CC-BY-NC-3.0' });
    });
    it('returns null for unknown urls', () => {
        expect(ccLicenseFromUrl('https://example.com/eula')).toBeNull();
    });
});

describe('registry', () => {
    it('rejects duplicate ids', () => {
        const reg = new ProviderRegistry();
        reg.register(stubProvider());
        expect(() => reg.register(stubProvider())).toThrow(/already registered/);
    });

    it('merges results and decorates badges centrally', async () => {
        const reg = new ProviderRegistry();
        reg.register(stubProvider({ id: 'a' }));
        reg.register(stubProvider({ id: 'b', downloadAuthType: 'oauth2' }));
        const merged = await reg.searchAll('x', {}, () => baseCtx);
        expect(merged.results).toHaveLength(2);
        expect(merged.results.find((r) => r.providerId === 'a')!.badge).toBe('free');
        expect(merged.results.find((r) => r.providerId === 'b')!.badge).toBe('login-required');
        expect(merged.errors).toHaveLength(0);
    });

    it('captures per-provider failures without sinking the search', async () => {
        const reg = new ProviderRegistry();
        reg.register(stubProvider({ id: 'good' }));
        reg.register(
            stubProvider({
                id: 'bad',
                search: async () => {
                    throw new ProviderAuthError('bad', 'no key');
                },
            }),
        );
        const merged = await reg.searchAll('x', {}, () => baseCtx);
        expect(merged.results).toHaveLength(1);
        expect(merged.errors).toEqual([{ providerId: 'bad', kind: 'auth', message: 'no key' }]);
    });
});
