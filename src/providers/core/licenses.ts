// Shared Creative Commons license knowledge. Providers that use CC licensing
// (Freesound does) map their native license URLs through here; providers with
// bespoke licenses (Pixabay) define their own LicenseInfo directly.

export interface CcLicense {
    id: string;
    name: string;
    attributionRequired: boolean;
}

// Keyed by the canonical path fragment that appears in creativecommons.org URLs.
// Order matters: more specific variants (by-nc-sa) before their prefixes (by-nc, by).
const CC_BY_PATH: Array<{ match: RegExp; license: CcLicense }> = [
    { match: /publicdomain\/zero/, license: { id: 'CC0-1.0', name: 'CC0 1.0 (Public Domain)', attributionRequired: false } },
    { match: /licenses\/by-nc-sa\/(\d)/, license: { id: 'CC-BY-NC-SA', name: 'Creative Commons Attribution-NonCommercial-ShareAlike', attributionRequired: true } },
    { match: /licenses\/by-nc-nd\/(\d)/, license: { id: 'CC-BY-NC-ND', name: 'Creative Commons Attribution-NonCommercial-NoDerivs', attributionRequired: true } },
    { match: /licenses\/by-nc\/(\d)/, license: { id: 'CC-BY-NC', name: 'Creative Commons Attribution-NonCommercial', attributionRequired: true } },
    { match: /licenses\/by-sa\/(\d)/, license: { id: 'CC-BY-SA', name: 'Creative Commons Attribution-ShareAlike', attributionRequired: true } },
    { match: /licenses\/by-nd\/(\d)/, license: { id: 'CC-BY-ND', name: 'Creative Commons Attribution-NoDerivs', attributionRequired: true } },
    { match: /licenses\/by\/(\d)/, license: { id: 'CC-BY', name: 'Creative Commons Attribution', attributionRequired: true } },
    { match: /licenses\/sampling\+/, license: { id: 'CC-Sampling+', name: 'Creative Commons Sampling Plus 1.0', attributionRequired: true } },
];

export function ccLicenseFromUrl(url: string): CcLicense | null {
    for (const { match, license } of CC_BY_PATH) {
        const m = url.match(match);
        if (m) {
            const version = m[1];
            if (version && license.id.startsWith('CC-BY')) {
                return {
                    ...license,
                    id: `${license.id}-${version}.0`,
                    name: `${license.name} ${version}.0`,
                };
            }
            return license;
        }
    }
    return null;
}
