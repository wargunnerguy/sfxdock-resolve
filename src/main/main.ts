import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeImage, protocol } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { IPC, type ConnectionState, type ExportOutcome, type FoldersView, type ImportOutcome } from '../shared/ipc';
import type { SoundResult } from '../providers/core/types';
import { ResolveBridge } from '../resolve/bridge';
import { PreviewCache } from './preview-cache';
import { attributionFor, download, ensureLocalFile, getLibrary, initSearch, registry, runSearch } from './search';
import { settings } from './settings';
import { ResolveFollower } from './follow-resolve';
import type { Library } from '../library/library';
import type { DownloadRecord } from '../library/types';

// 24x24 solid PNG — Electron rejects an empty drag icon, so this is a real,
// non-transparent image.
const DRAG_ICON = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAYAAADgdz34AAAAJUlEQVR4nGMwdov/T0vMMGrBqAWjFoxaMGrBqAWjFoxaMDQsAADjqCP9K8M8kQAAAABJRU5ErkJggg==',
);

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
const follower = new ResolveFollower(() => win);
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
    follower.stop();
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
        // Frameless: SFXDock draws its own chrome so compact mode can be a
        // borderless floating bar (frame can't be toggled after creation).
        frame: false,
        autoHideMenuBar: true,
        backgroundColor: '#1e1e1e',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
        },
    });
    // Compact preference persists across launches; apply frame-independent state early.
    if (settings.getCompact()) {
        win.setMinimumSize(300, 90);
        win.setAlwaysOnTop(true, 'floating');
        win.setSize(380, 100);
    }
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

    ipcMain.handle(IPC.getBinName, () => settings.getBinName());
    ipcMain.handle(IPC.setBinName, (_event, name: string) => {
        settings.setBinName(String(name));
        return settings.getBinName();
    });

    ipcMain.handle(IPC.importToResolve, async (_event, sound: SoundResult, query: string): Promise<ImportOutcome> => {
        const local = await ensureLocalFile(sound, String(query));
        if (local.status === 'login-required') return { status: 'login-required', message: local.message ?? '' };
        if (local.status !== 'ok' || !local.filePath) {
            return { status: 'error', message: local.message ?? 'Could not resolve a local file' };
        }
        const result = await bridge.importToBin(local.filePath, settings.getBinName());
        if (!result.ok) return { status: 'error', message: result.error ?? 'Import failed' };
        if (local.downloadId != null) {
            const snap = await bridge.snapshot();
            if (snap?.projectId) getLibrary().recordImport(snap.projectId, local.downloadId);
        }
        return { status: 'ok', binName: result.binName, clipName: result.clipName };
    });

    ipcMain.handle(IPC.exportAttributions, async (): Promise<ExportOutcome> => {
        const snap = await bridge.snapshot();
        if (!snap?.projectId) return { status: 'error', message: 'No open Resolve project' };
        const items = getLibrary().importsForProject(snap.projectId);
        if (items.length === 0) return { status: 'empty' };
        const projectName = snap.projectName ?? 'project';
        const save = await dialog.showSaveDialog({
            title: 'Export attribution list',
            defaultPath: `${projectName.replace(/[^\w -]/g, '_')} - attributions.txt`,
            filters: [{ name: 'Text', extensions: ['txt'] }],
        });
        if (save.canceled || !save.filePath) return { status: 'cancelled' };
        try {
            fs.writeFileSync(save.filePath, formatAttributions(projectName, items));
        } catch (e) {
            return { status: 'error', message: e instanceof Error ? e.message : String(e) };
        }
        return { status: 'ok', filePath: save.filePath, count: items.length };
    });

    ipcMain.on(IPC.startDrag, (event, filePath: string) => {
        if (typeof filePath === 'string' && fs.existsSync(filePath)) {
            event.sender.startDrag({ file: filePath, icon: DRAG_ICON });
        }
    });

    ipcMain.handle(IPC.getCompact, () => settings.getCompact());
    ipcMain.handle(IPC.setCompact, (_event, compact: boolean) => {
        settings.setCompact(Boolean(compact));
        if (!win) return;
        if (compact) {
            win.setMinimumSize(300, 90);
            win.setAlwaysOnTop(true, 'floating');
        } else {
            win.setMinimumSize(360, 480);
        }
    });
    ipcMain.on(IPC.setWindowSize, (_event, width: number, height: number) => {
        if (win && Number.isFinite(width) && Number.isFinite(height)) {
            win.setSize(Math.round(width), Math.round(height));
        }
    });
    ipcMain.on(IPC.closeWindow, () => win?.close());
    ipcMain.on(IPC.minimizeWindow, () => win?.minimize());

    ipcMain.handle(IPC.getFollowResolve, () => follower.active);
    ipcMain.handle(IPC.setFollowResolve, (_event, follow: boolean) => {
        if (process.platform !== 'win32') return false; // Windows-only in v1
        settings.setFollowResolve(Boolean(follow));
        if (follow) follower.start();
        else follower.stop();
        return follower.active;
    });
    if (settings.getFollowResolve()) follower.start();

    createWindow();
    void refreshState();
    pollTimer = setInterval(() => void refreshState(), POLL_MS);
});

function formatAttributions(projectName: string, items: DownloadRecord[]): string {
    const lines: string[] = [
        `Sound attributions for "${projectName}"`,
        `Generated by SFXDock on ${new Date().toISOString().slice(0, 10)}`,
        `${items.length} sound${items.length === 1 ? '' : 's'} used`,
        '',
    ];
    for (const it of items) {
        lines.push(it.attribution);
        if (!it.attributionRequired) lines[lines.length - 1] += '  (no attribution required)';
    }
    lines.push('');
    return lines.join('\r\n');
}

// Panel app: window closed means quit, on every platform.
app.on('window-all-closed', shutdown);

app.on('will-quit', shutdown);
