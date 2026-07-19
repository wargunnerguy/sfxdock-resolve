// IPC contract between main and renderer. Both sides import from here only.

import type { SoundResult } from '../providers/core/types';
import type { ProviderFailure } from '../providers/core/registry';

export const IPC = {
    getState: 'sfxdock:get-state',
    setPinned: 'sfxdock:set-pinned',
    stateChanged: 'sfxdock:state-changed',
    search: 'sfxdock:search',
    getKeyStatus: 'sfxdock:get-key-status',
    setProviderKey: 'sfxdock:set-provider-key',
} as const;

export interface SearchResponse {
    results: SoundResult[];
    errors: ProviderFailure[];
}

/** providerId -> whether a key is stored. Keys themselves never cross IPC. */
export type KeyStatus = Record<string, boolean>;

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
    search(query: string): Promise<SearchResponse>;
    getKeyStatus(): Promise<KeyStatus>;
    setProviderKey(providerId: string, key: string): Promise<KeyStatus>;
}
