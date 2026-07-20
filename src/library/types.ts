import type { ContentType } from '../providers/core/types';

export interface DownloadRecord {
    id: number;
    /** Original remote provider the sound came from (e.g. 'freesound', 'jamendo'). */
    providerId: string;
    sourceId: string;
    title: string;
    author: string | null;
    licenseId: string;
    licenseName: string;
    licenseUrl: string | null;
    attribution: string;
    attributionRequired: boolean;
    tags: string;
    originalQuery: string;
    filePath: string;
    durationSec: number;
    format: string;
    contentType: ContentType;
    downloadedAt: number;
}

/** A deliberate download about to be recorded (id/downloadedAt assigned by the library). */
export type NewDownload = Omit<DownloadRecord, 'id' | 'downloadedAt'>;

export interface WatchedFolder {
    id: number;
    path: string;
    /** false for the pre-registered downloads folder (cannot be removed). */
    removable: boolean;
    addedAt: number;
}

/** A normalized local result the Local Folders provider turns into a RawSoundResult. */
export interface LocalSearchHit {
    soundId: string;
    title: string;
    author: string | null;
    durationSec: number;
    /** Ready-built quality/format label (e.g. "44.1kHz · 16-bit · WAV", "MP3"). */
    quality?: string;
    filePath: string;
    /** License URL/id, or '' for a plain watched-folder file the user owns. */
    license: string;
    licenseName: string;
    attribution: string;
    attributionRequired: boolean;
}

/** The capability the Local Folders provider depends on (implemented by Library). */
export interface LocalIndex {
    searchLocal(query: string, contentType?: ContentType): LocalSearchHit[];
}
