import { describe, expect, it } from 'vitest';
import { createLocalProvider } from '../../src/providers/local';
import type { LocalIndex, LocalSearchHit } from '../../src/library/types';
import type { ProviderContext } from '../../src/providers/core/types';
import { describeProviderConformance } from './conformance';

const fakeHit: LocalSearchHit = {
    soundId: 'freesound:1',
    title: 'Owned Door',
    author: 'me',
    durationSec: 3,
    quality: '44.1kHz · 16-bit · WAV',
    filePath: 'C:/sfx/door.wav',
    license: 'http://creativecommons.org/licenses/by/4.0/',
    licenseName: 'Creative Commons Attribution 4.0',
    attribution: '"Owned Door" by me',
    attributionRequired: true,
};

const fakeIndex: LocalIndex = {
    searchLocal: () => [fakeHit],
};

const ctx: ProviderContext = { apiKey: null, hasOAuth: false, fetch };

describeProviderConformance(() => ({
    provider: createLocalProvider(fakeIndex),
    ctx,
    query: 'door',
}));

describe('local provider specifics', () => {
    it('emits file:// preview urls and render waveforms', async () => {
        const provider = createLocalProvider(fakeIndex);
        const results = await provider.search('door', {}, ctx);
        expect(results[0]!.previewUrl.startsWith('file:///')).toBe(true);
        expect(results[0]!.waveform).toEqual({ type: 'render' });
    });

    it('never offers a download (already on disk)', async () => {
        const provider = createLocalProvider(fakeIndex);
        const results = await provider.search('door', {}, ctx);
        expect(await provider.getDownload(results[0]!, ctx)).toBeNull();
    });

    it('carries stored attribution through licenseInfo', async () => {
        const provider = createLocalProvider(fakeIndex);
        const results = await provider.search('door', {}, ctx);
        const info = provider.licenseInfo(results[0]!);
        expect(info.attribution).toBe('"Owned Door" by me');
        expect(info.attributionRequired).toBe(true);
    });

    it('treats a plain watched file (no license) as attribution-free', async () => {
        const plain: LocalIndex = {
            searchLocal: () => [
                { ...fakeHit, soundId: 'file:5', license: '', licenseName: 'Local file', attribution: 'x.wav', attributionRequired: false },
            ],
        };
        const provider = createLocalProvider(plain);
        const results = await provider.search('x', {}, ctx);
        expect(results[0]!.license).toBe('local-file');
        const info = provider.licenseInfo(results[0]!);
        expect(info.attributionRequired).toBe(false);
        expect(info.url).toBeUndefined();
    });
});
