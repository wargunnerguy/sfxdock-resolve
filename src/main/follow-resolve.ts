// Optional "follow Resolve" positioning (Windows only). Moves the plugin
// window by the same delta whenever Resolve's window moves — so it tracks
// Resolve, but stays put (and stays freely draggable) when Resolve doesn't
// move. Tracking deltas rather than locking an absolute offset means dragging
// the panel yourself sticks instead of snapping back.
//
// Electron can't read another app's window bounds, and we deliberately ship no
// native modules, so a tiny persistent PowerShell helper reports Resolve's
// window rect via user32 GetWindowRect.

import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { BrowserWindow } from 'electron';

const POLL_MS = 350;

const PS_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class SfxWin {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
"@
while ($true) {
  $p = Get-Process -Name Resolve | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
  if ($p) {
    $r = New-Object SfxWin+RECT
    [void][SfxWin]::GetWindowRect($p.MainWindowHandle, [ref]$r)
    Write-Output ("{0},{1}" -f $r.Left, $r.Top)
  } else {
    Write-Output "none"
  }
  [Console]::Out.Flush()
  Start-Sleep -Milliseconds ${POLL_MS}
}
`;

export class ResolveFollower {
    private proc: ChildProcess | null = null;
    private scriptFile: string | null = null;
    private lastResolve: { x: number; y: number } | null = null;
    private buf = '';

    constructor(private getWin: () => BrowserWindow | null) {}

    get active(): boolean {
        return this.proc !== null;
    }

    start(): void {
        if (this.proc || process.platform !== 'win32') return;
        this.lastResolve = null; // first rect just seeds the baseline; no move
        try {
            this.scriptFile = path.join(os.tmpdir(), `sfxdock-follow-${process.pid}.ps1`);
            fs.writeFileSync(this.scriptFile, PS_SCRIPT);
            this.proc = spawn(
                'powershell.exe',
                ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', this.scriptFile],
                { windowsHide: true },
            );
            this.proc.stdout?.on('data', (d: Buffer) => this.onData(d.toString()));
            this.proc.on('exit', () => (this.proc = null));
        } catch {
            this.stop();
        }
    }

    stop(): void {
        if (this.proc) {
            try {
                this.proc.kill();
            } catch {
                /* ignore */
            }
            this.proc = null;
        }
        if (this.scriptFile) {
            fs.rm(this.scriptFile, { force: true }, () => undefined);
            this.scriptFile = null;
        }
        this.lastResolve = null;
    }

    private onData(chunk: string): void {
        this.buf += chunk;
        let nl: number;
        while ((nl = this.buf.indexOf('\n')) >= 0) {
            const line = this.buf.slice(0, nl).trim();
            this.buf = this.buf.slice(nl + 1);
            this.apply(line);
        }
    }

    private apply(line: string): void {
        const win = this.getWin();
        if (!win || line === '' || line === 'none') return;
        const parts = line.split(',');
        const l = parseInt(parts[0] ?? '', 10);
        const t = parseInt(parts[1] ?? '', 10);
        if (!Number.isFinite(l) || !Number.isFinite(t)) return;

        if (!this.lastResolve) {
            this.lastResolve = { x: l, y: t };
            return;
        }
        const dx = l - this.lastResolve.x;
        const dy = t - this.lastResolve.y;
        this.lastResolve = { x: l, y: t };
        if (dx === 0 && dy === 0) return; // Resolve didn't move — leave the panel alone

        const pos = win.getPosition();
        win.setPosition((pos[0] ?? 0) + dx, (pos[1] ?? 0) + dy);
    }
}
