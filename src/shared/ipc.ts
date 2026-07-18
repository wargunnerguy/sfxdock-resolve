// IPC contract between main and renderer. Both sides import from here only.

export const IPC = {
    getState: 'sfxdock:get-state',
    setPinned: 'sfxdock:set-pinned',
    stateChanged: 'sfxdock:state-changed',
} as const;

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
}
