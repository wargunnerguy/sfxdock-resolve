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
    copyAttribution: (sound) => ipcRenderer.invoke(IPC.copyAttribution, sound),
    listWatchedFolders: () => ipcRenderer.invoke(IPC.listWatchedFolders),
    addWatchedFolder: () => ipcRenderer.invoke(IPC.addWatchedFolder),
    removeWatchedFolder: (id) => ipcRenderer.invoke(IPC.removeWatchedFolder, id),
    rescan: () => ipcRenderer.invoke(IPC.rescan),
    importToResolve: (sound, query) => ipcRenderer.invoke(IPC.importToResolve, sound, query),
    exportAttributions: () => ipcRenderer.invoke(IPC.exportAttributions),
    getBinName: () => ipcRenderer.invoke(IPC.getBinName),
    setBinName: (name) => ipcRenderer.invoke(IPC.setBinName, name),
    startDrag: (filePath) => ipcRenderer.send(IPC.startDrag, filePath),
    getCompact: () => ipcRenderer.invoke(IPC.getCompact),
    setCompact: (compact) => ipcRenderer.invoke(IPC.setCompact, compact),
    setWindowSize: (width, height) => ipcRenderer.send(IPC.setWindowSize, width, height),
    closeWindow: () => ipcRenderer.send(IPC.closeWindow),
    minimizeWindow: () => ipcRenderer.send(IPC.minimizeWindow),
    getFollowResolve: () => ipcRenderer.invoke(IPC.getFollowResolve),
    setFollowResolve: (follow) => ipcRenderer.invoke(IPC.setFollowResolve, follow),
};

contextBridge.exposeInMainWorld('sfxdock', api);
