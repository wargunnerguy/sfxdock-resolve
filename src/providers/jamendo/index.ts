// Jamendo provider — API v3 (https://developer.jamendo.com/v3.0).
// Music (Creative Commons). The Jamendo "client_id" plays the apiKey role:
// it unlocks search, streaming AND downloads (when the track allows them),
// so downloadAuthType is apiKey too. Tracks ship waveform peaks data.

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

const API_BASE = 'https://api.jamendo.com/v3.0';
const DEFAULT_LIMIT = 30;

interface JamendoResponse {
    headers: {
        status: string;
        code: number;
        error_message?: string;
        results_count?: number;
    };
    results: JamendoTrack[];
}

interface JamendoTrack {
    id: number | string;
    name: string;
    artist_name: string;
    duration: number;
    license_ccurl: string;
    audio: string;
    audiodownload: string;
    audiodownload_allowed?: boolean;
    waveform?: unknown;
}

/** Jamendo's waveform arrives as {"peaks":[...]} — sometimes JSON-encoded as a string. */
function parsePeaks(raw: unknown): number[] | null {
    try {
        const obj: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
        const peaks = (obj as { peaks?: unknown } | null)?.peaks;
        if (Array.isArray(peaks) && peaks.length > 0 && peaks.every((n) => typeof n === 'number')) {
            return peaks as number[];
        }
    } catch {
        // fall through
    }
    return null;
}

export const jamendoProvider: Provider = {
    id: 'jamendo',
    displayName: 'Jamendo',
    homepageUrl: 'https://www.jamendo.com',
    authType: 'apiKey',
    downloadAuthType: 'apiKey',
    contentTypes: ['music'],

    async search(query: string, options: SearchOptions, ctx: ProviderContext): Promise<RawSoundResult[]> {
        if (!ctx.apiKey) {
            throw new ProviderAuthError(this.id, 'Jamendo client ID not set');
        }
        const url = new URL(`${API_BASE}/tracks/`);
        url.searchParams.set('client_id', ctx.apiKey);
        url.searchParams.set('format', 'json');
        url.searchParams.set('limit', String(options.limit ?? DEFAULT_LIMIT));
        url.searchParams.set('search', query);
        url.searchParams.set('include', 'licenses');
        url.searchParams.set('audioformat', 'mp32');

        let response: Response;
        try {
            response = await ctx.fetch(url.toString());
        } catch (e) {
            throw new ProviderError(this.id, 'network', `Jamendo unreachable: ${e instanceof Error ? e.message : e}`);
        }
        if (response.status === 401 || response.status === 403) {
            throw new ProviderAuthError(this.id, 'Jamendo rejected the client ID');
        }
        if (!response.ok) {
            throw new ProviderError(this.id, 'provider', `Jamendo returned HTTP ${response.status}`);
        }

        const body = (await response.json()) as JamendoResponse;
        if (body.headers.status !== 'success') {
            const msg = body.headers.error_message ?? `Jamendo error code ${body.headers.code}`;
            if (/client.?id|credential/i.test(msg)) {
                throw new ProviderAuthError(this.id, `Jamendo rejected the client ID: ${msg}`);
            }
            throw new ProviderError(this.id, 'provider', msg);
        }

        return (body.results ?? []).flatMap((track) => {
            if (!track.audio) return []; // unstreamable track is useless in a preview-first UI
            const peaks = parsePeaks(track.waveform);
            const downloadUrl = track.audiodownload_allowed && track.audiodownload ? track.audiodownload : null;
            return [
                {
                    providerId: this.id,
                    soundId: String(track.id),
                    title: track.name,
                    author: track.artist_name,
                    durationSec: track.duration,
                    license: track.license_ccurl,
                    quality: 'MP3',
                    previewUrl: track.audio,
                    waveform: peaks ? { type: 'peaks' as const, peaks } : { type: 'render' as const },
                    extra: { downloadUrl },
                },
            ];
        });
    },

    async getDownload(sound: RawSoundResult, _ctx: ProviderContext): Promise<DownloadDescriptor | null> {
        const downloadUrl = sound.extra?.['downloadUrl'];
        if (typeof downloadUrl !== 'string' || downloadUrl === '') return null;
        return {
            url: downloadUrl,
            requiredAuth: 'apiKey',
            suggestedFilename: `${sound.title}.mp3`,
        };
    },

    licenseInfo(sound: RawSoundResult): LicenseInfo {
        const cc = ccLicenseFromUrl(sound.license);
        const name = cc?.name ?? 'See license terms';
        const author = sound.author ?? 'unknown artist';
        return {
            id: cc?.id ?? 'unknown',
            name,
            url: sound.license,
            attributionRequired: cc?.attributionRequired ?? true,
            attribution: `"${sound.title}" by ${author} on Jamendo (jamendo.com), licensed under ${name} (${sound.license})`,
        };
    },
};
