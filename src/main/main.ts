import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { IPC, type ConnectionState } from '../shared/ipc';
import { ResolveBridge } from '../resolve/bridge';

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
    ipcMain.handle(IPC.getState, () => current);
    ipcMain.handle(IPC.setPinned, (_event, pinned: boolean) => {
        win?.setAlwaysOnTop(Boolean(pinned), 'floating');
        return win?.isAlwaysOnTop() ?? false;
    });
    createWindow();
    void refreshState();
    pollTimer = setInterval(() => void refreshState(), POLL_MS);
});

// Panel app: window closed means quit, on every platform.
app.on('window-all-closed', shutdown);

app.on('will-quit', shutdown);
