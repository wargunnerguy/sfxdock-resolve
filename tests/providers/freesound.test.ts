import { describe, expect, it } from 'vitest';
import { freesoundProvider } from '../../src/providers/freesound';
import { ProviderAuthError, ProviderError } from '../../src/providers/core/errors';
import type { ProviderContext } from '../../src/providers/core/types';
import { describeProviderConformance } from './conformance';
import fixture from '../fixtures/freesound-search.json';

function mockCtx(responder: (url: string) => Response): ProviderContext {
    return {
        apiKey: 'test-key-not-a-real-secret',
        hasOAuth: false,
        fetch: ((url: string) => Promise.resolve(responder(url))) as typeof fetch,
    };
}

const okCtx = () => mockCtx(() => new Response(JSON.stringify(fixture), { status: 200 }));

describeProviderConformance(() => ({
    provider: freesoundProvider,
    ctx: okCtx(),
    query: 'door slam',
}));

describe('freesound provider specifics', () => {
    it('requires an API key', async () => {
        const ctx: ProviderContext = { apiKey: null, hasOAuth: false, fetch };
        await expect(freesoundProvider.search('door', {}, ctx)).rejects.toBeInstanceOf(ProviderAuthError);
    });

    it('maps 401 to an auth error', async () => {
        const ctx = mockCtx(() => new Response('{}', { status: 401 }));
        await expect(freesoundProvider.search('door', {}, ctx)).rejects.toBeInstanceOf(ProviderAuthError);
    });

    it('maps 429 to a rate-limit error', async () => {
        const ctx = mockCtx(() => new Response('{}', { status: 429 }));
        await expect(freesoundProvider.search('door', {}, ctx)).rejects.toMatchObject({ kind: 'rate-limit' });
    });

    it('maps network failure to a network error', async () => {
        const ctx: ProviderContext = {
            apiKey: 'k',
            hasOAuth: false,
            fetch: (() => Promise.reject(new Error('offline'))) as typeof fetch,
        };
        await expect(freesoundProvider.search('door', {}, ctx)).rejects.toBeInstanceOf(ProviderError);
    });

    it('normalizes fields, preferring HQ mp3 preview and medium waveform', async () => {
        const results = await freesoundProvider.search('door slam', {}, okCtx());
        expect(results).toHaveLength(2);
        const first = results[0]!;
        expect(first.soundId).toBe('440261');
        expect(first.title).toBe('Door Slam - No Reverb.wav');
        expect(first.author).toBe('adriann');
        expect(first.durationSec).toBeCloseTo(4.193, 2);
        expect(first.previewUrl).toContain('-hq.mp3');
        expect(first.waveform).toEqual({
            type: 'provided',
            url: 'https://cdn.freesound.org/displays/440/440261_185249_wave_bw_M.png',
        });
    });

    it('maps CC0 and CC-BY licenses with correct attribution requirements', async () => {
        const results = await freesoundProvider.search('door slam', {}, okCtx());
        const cc0 = freesoundProvider.licenseInfo(results[0]!);
        expect(cc0.id).toBe('CC0-1.0');
        expect(cc0.attributionRequired).toBe(false);
        const ccBy = freesoundProvider.licenseInfo(results[1]!);
        expect(ccBy.id).toBe('CC-BY-4.0');
        expect(ccBy.attributionRequired).toBe(true);
        expect(ccBy.attribution).toContain('Creaky Hinge');
        expect(ccBy.attribution).toContain('sfx-author');
    });

    it('download descriptor demands oauth2', async () => {
        const results = await freesoundProvider.search('door slam', {}, okCtx());
        const dl = await freesoundProvider.getDownload(results[0]!, okCtx());
        expect(dl).toMatchObject({ requiredAuth: 'oauth2' });
        expect(dl!.url).toContain('/sounds/440261/download/');
    });
});
