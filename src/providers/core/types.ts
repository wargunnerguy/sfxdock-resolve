// The provider contract. This file (plus badges.ts and registry.ts) is the
// whole surface a community provider touches — adding a provider must never
// require changes outside src/providers/<name>/ and the registry (CLAUDE.md).
// Keep the description in CLAUDE.md's "Provider interface contract" section
// in sync with these definitions.

export type AuthType = 'none' | 'apiKey' | 'oauth2';

export type Badge = 'free' | 'login-required' | 'paid' | 'owned';

export type Waveform = { type: 'provided'; url: string } | { type: 'render' };

// What a provider's search() returns. Note: no badge — badges are derived
// centrally in core/badges.ts; providers never invent badge logic.
export interface RawSoundResult {
    providerId: string;
    soundId: string;
    title: string;
    /** Uploader/author name, used in attribution strings. */
    author?: string;
    durationSec: number;
    /** Provider-native license identifier (URL or id); mapped via licenseInfo(). */
    license: string;
    previewUrl: string;
    waveform: Waveform;
}

/** A RawSoundResult decorated with the centrally derived badge. */
export interface SoundResult extends RawSoundResult {
    badge: Badge;
}

export interface SearchOptions {
    /** Max results this provider should return (default provider-chosen, ~30). */
    limit?: number;
}

/** Everything a provider may use from the outside world — injectable for tests. */
export interface ProviderContext {
    apiKey: string | null;
    hasOAuth: boolean;
    fetch: typeof fetch;
}

export interface DownloadDescriptor {
    url: string;
    /** Auth level the download endpoint requires (may exceed search auth). */
    requiredAuth: AuthType;
    suggestedFilename?: string;
}

export interface LicenseInfo {
    /** Stable identifier, SPDX where possible (e.g. "CC0-1.0", "CC-BY-4.0"). */
    id: string;
    /** Human-readable name (e.g. "Creative Commons Attribution 4.0"). */
    name: string;
    url?: string;
    /** Ready-to-copy attribution line for this sound. */
    attribution: string;
    /** True when the license requires attribution on use. */
    attributionRequired: boolean;
}

export interface Provider {
    /** Stable kebab-case id (e.g. "freesound"); used in cache keys and the library DB. */
    id: string;
    displayName: string;
    homepageUrl: string;
    /** Auth needed for search + preview. */
    authType: AuthType;
    /** Auth needed for full-quality download (Freesound: oauth2 > apiKey). */
    downloadAuthType: AuthType;
    search(query: string, options: SearchOptions, ctx: ProviderContext): Promise<RawSoundResult[]>;
    /** null = nothing to download (e.g. local files are already on disk). */
    getDownload(sound: RawSoundResult, ctx: ProviderContext): Promise<DownloadDescriptor | null>;
    licenseInfo(sound: RawSoundResult): LicenseInfo;
}
