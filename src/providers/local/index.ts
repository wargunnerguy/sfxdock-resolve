// Local Folders provider — the built-in non-HTTP provider (proves the
// contract works without network, per CLAUDE.md). Unlike community providers
// it needs library access, so it's created via a factory that injects the
// LocalIndex rather than reading anything from ProviderContext.

import type { LocalIndex } from '../../library/types';
import type {
    DownloadDescriptor,
    LicenseInfo,
    Provider,
    RawSoundResult,
    SearchOptions,
} from '../core/types';

export const LOCAL_PROVIDER_ID = 'local';

export function createLocalProvider(index: LocalIndex): Provider {
    return {
        id: LOCAL_PROVIDER_ID,
        displayName: 'Local Folders',
        homepageUrl: 'https://github.com/wargunnerguy/sfxdock-resolve',
        authType: 'none',
        downloadAuthType: 'none',
        contentTypes: ['sfx', 'music'],

        async search(query: string, options: SearchOptions): Promise<RawSoundResult[]> {
            return index.searchLocal(query, options.contentType).map((hit) => ({
                providerId: LOCAL_PROVIDER_ID,
                soundId: hit.soundId,
                title: hit.title,
                author: hit.author ?? undefined,
                durationSec: hit.durationSec,
                license: hit.license || 'local-file',
                // file:// URL — the preview protocol streams it straight from disk.
                previewUrl: pathToFileUrl(hit.filePath),
                waveform: { type: 'render' },
                extra: {
                    filePath: hit.filePath,
                    licenseName: hit.licenseName,
                    attribution: hit.attribution,
                    attributionRequired: hit.attributionRequired,
                },
            }));
        },

        // Already on disk — nothing to download.
        async getDownload(): Promise<DownloadDescriptor | null> {
            return null;
        },

        licenseInfo(sound: RawSoundResult): LicenseInfo {
            const licenseName = (sound.extra?.['licenseName'] as string | undefined) ?? 'Local file';
            const attribution = (sound.extra?.['attribution'] as string | undefined) ?? sound.title;
            const attributionRequired = (sound.extra?.['attributionRequired'] as boolean | undefined) ?? false;
            return {
                id: sound.license === 'local-file' ? 'local' : sound.license,
                name: licenseName,
                url: sound.license === 'local-file' ? undefined : sound.license,
                attribution,
                attributionRequired,
            };
        },
    };
}

function pathToFileUrl(filePath: string): string {
    // Minimal file:// encoding; the preview protocol decodes it back to a path.
    const normalized = filePath.replace(/\\/g, '/');
    return `file:///${encodeURI(normalized).replace(/^file:\/\/\//, '')}`;
}
