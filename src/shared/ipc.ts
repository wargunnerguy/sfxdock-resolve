// IPC contract between main and renderer. Both sides import from here only.

import type { ContentType, SoundResult } from '../providers/core/types';
import type { ProviderFailure } from '../providers/core/registry';
import type { WatchedFolder } from '../library/types';

export const IPC = {
    getState: 'sfxdock:get-state',
    setPinned: 'sfxdock:set-pinned',
    stateChanged: 'sfxdock:state-changed',
    search: 'sfxdock:search',
    getKeyStatus: 'sfxdock:get-key-status',
    setProviderKey: 'sfxdock:set-provider-key',
    download: 'sfxdock:download',
    copyAttribution: 'sfxdock:copy-attribution',
    listWatchedFolders: 'sfxdock:list-watched-folders',
    addWatchedFolder: 'sfxdock:add-watched-folder',
    removeWatchedFolder: 'sfxdock:remove-watched-folder',
    rescan: 'sfxdock:rescan',
} as const;

export interface SearchResponse {
    results: SoundResult[];
    errors: ProviderFailure[];
}

/** providerId -> whether a key is stored. Keys themselves never cross IPC. */
export type KeyStatus = Record<string, boolean>;

export type DownloadOutcome =
    | { status: 'ok'; filePath: string }
    | { status: 'already-owned'; filePath?: string }
    | { status: 'login-required'; message: string }
    | { status: 'error'; message: string };

export interface FoldersView {
    folders: WatchedFolder[];
    downloadsDir: string;
}

export interface RescanView {
    added: number;
    removed: number;
    scannedFolders: number;
}

export interface ConnectionState {
    connected: boolean;
    productName?: string;
    resolveVersion?: string;
    projectName?: string;
    projectId?: string;
    error?: string;
}

// Surface exposed to the renderer via contextBridge as window.sfxdock.
export interface SfxdockApi {
    getState(): Promise<ConnectionState>;
    setPinned(pinned: boolean): Promise<boolean>;
    onStateChanged(cb: (state: ConnectionState) => void): () => void;
    search(query: string, contentType?: ContentType): Promise<SearchResponse>;
    getKeyStatus(): Promise<KeyStatus>;
    setProviderKey(providerId: string, key: string): Promise<KeyStatus>;
    download(sound: SoundResult, query: string): Promise<DownloadOutcome>;
    /** Builds the attribution line and copies it to the system clipboard (in main). Returns the text. */
    copyAttribution(sound: SoundResult): Promise<string>;
    listWatchedFolders(): Promise<FoldersView>;
    addWatchedFolder(): Promise<FoldersView>;
    removeWatchedFolder(id: number): Promise<FoldersView>;
    rescan(): Promise<RescanView>;
}
