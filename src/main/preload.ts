import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type ConnectionState, type SfxdockApi } from '../shared/ipc';

const api: SfxdockApi = {
    getState: () => ipcRenderer.invoke(IPC.getState),
    setPinned: (pinned) => ipcRenderer.invoke(IPC.setPinned, pinned),
    onStateChanged: (cb) => {
        const listener = (_event: unknown, state: ConnectionState) => cb(state);
        ipcRenderer.on(IPC.stateChanged, listener);
        return () => ipcRenderer.removeListener(IPC.stateChanged, listener);
    },
};

contextBridge.exposeInMainWorld('sfxdock', api);
