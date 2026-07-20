// IPC contract between main and renderer. Both sides import from here only.

import type { ContentType, SoundResult } from '../providers/core/types';
import type { ProviderFailure } from '../providers/core/registry';
import type { WatchedFolder } from '../library/types';

export type ResultField = 'duration' | 'quality' | 'author' | 'provider';
export type ResultFields = Record<ResultField, boolean>;

/** OAuth connection status per provider that supports it. */
export interface AuthStatus {
    freesound: boolean;
}

export type ConnectOutcome = { ok: true } | { ok: false; error: string };

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
    importToResolve: 'sfxdock:import-to-resolve',
    exportAttributions: 'sfxdock:export-attributions',
    getBinName: 'sfxdock:get-bin-name',
    setBinName: 'sfxdock:set-bin-name',
    startDrag: 'sfxdock:start-drag',
    getCompact: 'sfxdock:get-compact',
    setCompact: 'sfxdock:set-compact',
    setWindowSize: 'sfxdock:set-window-size',
    closeWindow: 'sfxdock:close-window',
    minimizeWindow: 'sfxdock:minimize-window',
    getFollowResolve: 'sfxdock:get-follow-resolve',
    setFollowResolve: 'sfxdock:set-follow-resolve',
    getResultFields: 'sfxdock:get-result-fields',
    setResultField: 'sfxdock:set-result-field',
    getFreesoundClientId: 'sfxdock:get-freesound-client-id',
    setFreesoundClientId: 'sfxdock:set-freesound-client-id',
    getAuthStatus: 'sfxdock:get-auth-status',
    connectFreesound: 'sfxdock:connect-freesound',
    disconnectFreesound: 'sfxdock:disconnect-freesound',
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

export type ImportOutcome =
    | { status: 'ok'; binName: string; clipName?: string }
    | { status: 'login-required'; message: string }
    | { status: 'error'; message: string };

export type ExportOutcome =
    | { status: 'ok'; filePath: string; count: number }
    | { status: 'empty' }
    | { status: 'cancelled' }
    | { status: 'error'; message: string };

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
    importToResolve(sound: SoundResult, query: string): Promise<ImportOutcome>;
    exportAttributions(): Promise<ExportOutcome>;
    getBinName(): Promise<string>;
    setBinName(name: string): Promise<string>;
    /** Begins a native OS file drag of an already-on-disk sound (fire-and-forget). */
    startDrag(filePath: string): void;
    getCompact(): Promise<boolean>;
    setCompact(compact: boolean): Promise<void>;
    /** Resizes the plugin window in place (keeps its top-left position). */
    setWindowSize(width: number, height: number): void;
    closeWindow(): void;
    minimizeWindow(): void;
    /** Windows only: keep the window at a fixed offset from Resolve's window. Returns the effective state. */
    getFollowResolve(): Promise<boolean>;
    setFollowResolve(follow: boolean): Promise<boolean>;
    getResultFields(): Promise<ResultFields>;
    setResultField(field: ResultField, show: boolean): Promise<ResultFields>;
    getFreesoundClientId(): Promise<string>;
    setFreesoundClientId(id: string): Promise<string>;
    getAuthStatus(): Promise<AuthStatus>;
    connectFreesound(): Promise<ConnectOutcome>;
    disconnectFreesound(): Promise<AuthStatus>;
}
