import { app, BrowserWindow, clipboard, dialog, ipcMain, protocol } from 'electron';
import path from 'node:path';
import { IPC, type ConnectionState, type FoldersView } from '../shared/ipc';
import type { SoundResult } from '../providers/core/types';
import { ResolveBridge } from '../resolve/bridge';
import { PreviewCache } from './preview-cache';
import { attributionFor, download, initSearch, registry, runSearch } from './search';
import { settings } from './settings';
import type { Library } from '../library/library';

// Must run before app ready: the preview protocol needs stream privileges.
// 'standard' gives the scheme proper host/path URL semantics; without it and
// supportFetchAPI, Chromium's media stack can refuse to load the source.
protocol.registerSchemesAsPrivileged([
    {
        scheme: 'sfx-preview',
        privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true },
    },
]);

const previewCache = new PreviewCache();
let library: Library;
let downloadsDir: string;

function foldersView(): FoldersView {
    return { folders: library.listWatchedFolders(), downloadsDir };
}

const PLUGIN_ID = 'com.costlio.sfxdock';
const POLL_MS = 2000;

const bridge = new ResolveBridge();
let win: BrowserWindow | null = null;
let current: ConnectionState = { connected: false };
let pollTimer: ReturnType<typeof setInterval> | null = null;
let refreshing = false;
let quitHookRegistered = false;

let shuttingDown = false;

// Shutdown must NOT call WorkflowIntegration.CleanUp(): on Resolve 21 /
// module v2.0.0 it blocks the main thread forever, leaking the process and
// locking WorkflowIntegration.node on disk (verified 2026-07-19; Blackmagic's
// own sample leaks the same way). Process exit severs the host connection
// safely — Resolve is unaffected. Graceful quit first, force-exit fallback
// because the native module can keep the event loop alive.
function shutdown(): void {
    if (shuttingDown) return;
    shuttingDown = true;
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
    const forceExit = setTimeout(() => app.exit(0), 800);
    forceExit.unref?.();
    app.quit();
}

async function refreshState(): Promise<void> {
    if (refreshing) return;
    refreshing = true;
    try {
        if (!bridge.connected) {
            await bridge.connect(PLUGIN_ID);
            if (bridge.connected && !quitHookRegistered) {
                bridge.onResolveQuit(shutdown);
                quitHookRegistered = true;
            }
        }
        const snap = bridge.connected ? await bridge.snapshot() : null;
        const next: ConnectionState = snap
            ? {
                  connected: true,
                  productName: bridge.productName ?? undefined,
                  resolveVersion: bridge.resolveVersion ?? undefined,
                  projectName: snap.projectName ?? undefined,
                  projectId: snap.projectId ?? undefined,
              }
            : { connected: false, error: bridge.lastError ?? undefined };
        if (JSON.stringify(next) !== JSON.stringify(current)) {
            current = next;
            win?.webContents.send(IPC.stateChanged, current);
        }
    } finally {
        refreshing = false;
    }
}

function createWindow(): void {
    win = new BrowserWindow({
        width: 420,
        height: 640,
        minWidth: 360,
        minHeight: 480,
        title: 'SFXDock',
        autoHideMenuBar: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
        },
    });
    win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
    win.on('closed', () => {
        win = null;
        shutdown();
    });
}

app.whenReady().then(() => {
    settings.load();
    previewCache.init();
    ({ library, downloadsDir } = initSearch());

    // sfx-preview://<providerId>/<soundId> → cached or proxied preview stream.
    protocol.handle('sfx-preview', async (request) => {
        const url = new URL(request.url);
        const providerId = url.host;
        const soundId = decodeURIComponent(url.pathname.replace(/^\//, ''));
        try {
            return await previewCache.handleRequest(providerId, soundId);
        } catch {
            return new Response('Preview handler error', { status: 500 });
        }
    });

    ipcMain.handle(IPC.getState, () => current);
    ipcMain.handle(IPC.setPinned, (_event, pinned: boolean) => {
        win?.setAlwaysOnTop(Boolean(pinned), 'floating');
        return win?.isAlwaysOnTop() ?? false;
    });
    ipcMain.handle(IPC.search, (_event, query: string, contentType?: string) =>
        runSearch(
            String(query),
            contentType === 'sfx' || contentType === 'music' ? contentType : undefined,
            previewCache,
        ),
    );
    // Only remote providers have keys; the local provider is authless.
    const keyedProviders = () => registry.all().filter((p) => p.authType !== 'none').map((p) => p.id);
    ipcMain.handle(IPC.getKeyStatus, () => settings.keyStatus(keyedProviders()));
    ipcMain.handle(IPC.setProviderKey, (_event, providerId: string, key: string) => {
        settings.setProviderKey(String(providerId), String(key));
        return settings.keyStatus(keyedProviders());
    });

    ipcMain.handle(IPC.download, (_event, sound: SoundResult, query: string) => download(sound, String(query)));
    ipcMain.handle(IPC.copyAttribution, (_event, sound: SoundResult) => {
        const text = attributionFor(sound);
        clipboard.writeText(text);
        return text;
    });

    ipcMain.handle(IPC.listWatchedFolders, () => foldersView());
    ipcMain.handle(IPC.addWatchedFolder, async () => {
        const result = await dialog.showOpenDialog({
            title: 'Add a folder to watch',
            properties: ['openDirectory'],
        });
        if (!result.canceled && result.filePaths[0]) {
            library.addWatchedFolder(result.filePaths[0]);
            library.rescan();
        }
        return foldersView();
    });
    ipcMain.handle(IPC.removeWatchedFolder, (_event, id: number) => {
        library.removeWatchedFolder(Number(id));
        return foldersView();
    });
    ipcMain.handle(IPC.rescan, () => library.rescan());

    createWindow();
    void refreshState();
    pollTimer = setInterval(() => void refreshState(), POLL_MS);
});

// Panel app: window closed means quit, on every platform.
app.on('window-all-closed', shutdown);

app.on('will-quit', shutdown);
