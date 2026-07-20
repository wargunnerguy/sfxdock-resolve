// Freesound provider — API v2 (https://freesound.org/docs/api/).
// apiKey ("Token" header) unlocks search + previews; full-quality download
// requires OAuth2 (Phase 6). Preview/waveform URLs are public CDN links.

import { ProviderAuthError, ProviderError } from '../core/errors';
import { ccLicenseFromUrl } from '../core/licenses';
import type {
    DownloadDescriptor,
    LicenseInfo,
    Provider,
    ProviderContext,
    RawSoundResult,
    SearchOptions,
} from '../core/types';

const API_BASE = 'https://freesound.org/apiv2';
const FIELDS = 'id,name,username,duration,license,previews,images,type,bitrate,bitdepth,samplerate';
const DEFAULT_LIMIT = 30;

const LOSSLESS = new Set(['wav', 'aiff', 'aif', 'flac']);

function freesoundQuality(s: FreesoundSound): string | undefined {
    const type = (s.type ?? '').toLowerCase();
    const parts: string[] = [];
    const khz = s.samplerate ? `${(s.samplerate / 1000).toFixed(1).replace(/\.0$/, '')}kHz` : '';
    if (LOSSLESS.has(type)) {
        if (khz) parts.push(khz);
        if (s.bitdepth) parts.push(`${s.bitdepth}-bit`);
    } else {
        if (s.bitrate) parts.push(`${Math.round(s.bitrate)}kbps`);
        if (khz) parts.push(khz);
    }
    if (type) parts.push(type.toUpperCase());
    return parts.length > 0 ? parts.join(' · ') : undefined;
}

// Verified response shape (probed live 2026-07-19 against API v2).
interface FreesoundSearchResponse {
    count: number;
    results: FreesoundSound[];
}

interface FreesoundSound {
    id: number;
    name: string;
    username: string;
    duration: number;
    license: string;
    previews: Record<string, string>;
    images: Record<string, string>;
    type?: string;
    bitrate?: number;
    bitdepth?: number;
    samplerate?: number;
}

export const freesoundProvider: Provider = {
    id: 'freesound',
    displayName: 'Freesound',
    homepageUrl: 'https://freesound.org',
    authType: 'apiKey',
    downloadAuthType: 'oauth2',
    contentTypes: ['sfx'],

    async search(query: string, options: SearchOptions, ctx: ProviderContext): Promise<RawSoundResult[]> {
        if (!ctx.apiKey) {
            throw new ProviderAuthError(this.id, 'Freesound API key not set');
        }
        const url = new URL(`${API_BASE}/search/text/`);
        url.searchParams.set('query', query);
        url.searchParams.set('fields', FIELDS);
        url.searchParams.set('page_size', String(options.limit ?? DEFAULT_LIMIT));

        let response: Response;
        try {
            response = await ctx.fetch(url.toString(), {
                headers: { Authorization: `Token ${ctx.apiKey}` },
            });
        } catch (e) {
            throw new ProviderError(this.id, 'network', `Freesound unreachable: ${e instanceof Error ? e.message : e}`);
        }
        if (response.status === 401 || response.status === 403) {
            throw new ProviderAuthError(this.id, 'Freesound rejected the API key');
        }
        if (response.status === 429) {
            throw new ProviderError(this.id, 'rate-limit', 'Freesound rate limit reached — try again shortly');
        }
        if (!response.ok) {
            throw new ProviderError(this.id, 'provider', `Freesound returned HTTP ${response.status}`);
        }

        const body = (await response.json()) as FreesoundSearchResponse;
        return body.results.flatMap((sound) => {
            const previewUrl = sound.previews['preview-hq-mp3'] ?? sound.previews['preview-lq-mp3'];
            if (!previewUrl) return []; // unplayable result is useless in a preview-first UI
            const waveformUrl = sound.images['waveform_m'] ?? sound.images['waveform_l'];
            return [
                {
                    providerId: this.id,
                    soundId: String(sound.id),
                    title: sound.name,
                    author: sound.username,
                    durationSec: sound.duration,
                    license: sound.license,
                    quality: freesoundQuality(sound),
                    previewUrl,
                    waveform: waveformUrl ? { type: 'provided' as const, url: waveformUrl } : { type: 'render' as const },
                },
            ];
        });
    },

    async getDownload(sound: RawSoundResult, _ctx: ProviderContext): Promise<DownloadDescriptor | null> {
        return {
            url: `${API_BASE}/sounds/${sound.soundId}/download/`,
            requiredAuth: 'oauth2',
            suggestedFilename: sound.title,
        };
    },

    licenseInfo(sound: RawSoundResult): LicenseInfo {
        const cc = ccLicenseFromUrl(sound.license);
        const name = cc?.name ?? 'See license terms';
        const attributionRequired = cc?.attributionRequired ?? true;
        const author = sound.author ?? 'unknown author';
        return {
            id: cc?.id ?? 'unknown',
            name,
            url: sound.license,
            attributionRequired,
            attribution: `"${sound.title}" by ${author} on Freesound (freesound.org), licensed under ${name} (${sound.license})`,
        };
    },
};
