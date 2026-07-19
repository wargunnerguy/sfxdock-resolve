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
    search: (query, contentType) => ipcRenderer.invoke(IPC.search, query, contentType),
    getKeyStatus: () => ipcRenderer.invoke(IPC.getKeyStatus),
    setProviderKey: (providerId, key) => ipcRenderer.invoke(IPC.setProviderKey, providerId, key),
    download: (sound, query) => ipcRenderer.invoke(IPC.download, sound, query),
    getAttribution: (sound) => ipcRenderer.invoke(IPC.getAttribution, sound),
    listWatchedFolders: () => ipcRenderer.invoke(IPC.listWatchedFolders),
    addWatchedFolder: () => ipcRenderer.invoke(IPC.addWatchedFolder),
    removeWatchedFolder: (id) => ipcRenderer.invoke(IPC.removeWatchedFolder, id),
    rescan: () => ipcRenderer.invoke(IPC.rescan),
};

contextBridge.exposeInMainWorld('sfxdock', api);
