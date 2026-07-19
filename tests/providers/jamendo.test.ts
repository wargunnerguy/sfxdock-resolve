import { describe, expect, it } from 'vitest';
import { jamendoProvider } from '../../src/providers/jamendo';
import { ProviderAuthError } from '../../src/providers/core/errors';
import type { ProviderContext } from '../../src/providers/core/types';
import { describeProviderConformance } from './conformance';
import fixture from '../fixtures/jamendo-search.json';

function mockCtx(responder: (url: string) => Response): ProviderContext {
    return {
        apiKey: 'test-client-id-not-a-real-secret',
        hasOAuth: false,
        fetch: ((url: string) => Promise.resolve(responder(url))) as typeof fetch,
    };
}

const okCtx = () => mockCtx(() => new Response(JSON.stringify(fixture), { status: 200 }));

describeProviderConformance(() => ({
    provider: jamendoProvider,
    ctx: okCtx(),
    query: 'morning',
}));

describe('jamendo provider specifics', () => {
    it('requires a client id', async () => {
        const ctx: ProviderContext = { apiKey: null, hasOAuth: false, fetch };
        await expect(jamendoProvider.search('x', {}, ctx)).rejects.toBeInstanceOf(ProviderAuthError);
    });

    it('maps in-body credential errors to auth errors (Jamendo returns HTTP 200 for those)', async () => {
        const errBody = {
            headers: { status: 'failed', code: 5, error_message: 'Your client_id is not authorized' },
            results: [],
        };
        const ctx = mockCtx(() => new Response(JSON.stringify(errBody), { status: 200 }));
        await expect(jamendoProvider.search('x', {}, ctx)).rejects.toBeInstanceOf(ProviderAuthError);
    });

    it('parses string-encoded waveform peaks and falls back to render when absent', async () => {
        const results = await jamendoProvider.search('morning', {}, okCtx());
        expect(results).toHaveLength(2);
        expect(results[0]!.waveform).toEqual({
            type: 'peaks',
            peaks: [0, 12, 25, 40, 38, 52, 61, 45, 30, 22, 15, 8, 3],
        });
        expect(results[1]!.waveform).toEqual({ type: 'render' });
    });

    it('offers download only when the track allows it', async () => {
        const results = await jamendoProvider.search('morning', {}, okCtx());
        const allowed = await jamendoProvider.getDownload(results[0]!, okCtx());
        expect(allowed).toMatchObject({ requiredAuth: 'apiKey' });
        expect(allowed!.url).toContain('/download/track/168066/');
        const denied = await jamendoProvider.getDownload(results[1]!, okCtx());
        expect(denied).toBeNull();
    });

    it('maps ShareAlike and NoDerivs license variants', async () => {
        const results = await jamendoProvider.search('morning', {}, okCtx());
        const bySa = jamendoProvider.licenseInfo(results[0]!);
        expect(bySa.id).toBe('CC-BY-SA-3.0');
        expect(bySa.attributionRequired).toBe(true);
        const byNcNd = jamendoProvider.licenseInfo(results[1]!);
        expect(byNcNd.id).toBe('CC-BY-NC-ND-3.0');
        expect(byNcNd.attribution).toContain('Synth Duo');
    });
});
