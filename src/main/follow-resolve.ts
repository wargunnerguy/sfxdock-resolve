// Optional "follow Resolve" positioning (Windows only). Keeps the plugin
// window at a fixed offset from Resolve's main window as Resolve moves.
//
// Electron can't read another app's window bounds, and we deliberately ship no
// native modules, so a tiny persistent PowerShell helper reports Resolve's
// window rect via user32 GetWindowRect. The offset is captured when following
// starts, so the user positions the bar once and it sticks relative to Resolve.

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
    private offset: { x: number; y: number } | null = null;
    private buf = '';

    constructor(private getWin: () => BrowserWindow | null) {}

    get active(): boolean {
        return this.proc !== null;
    }

    start(): void {
        if (this.proc || process.platform !== 'win32') return;
        this.offset = null; // recaptured from the first rect, preserving current placement
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
        this.offset = null;
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
        const [l, t] = line.split(',').map((n) => parseInt(n, 10));
        if (!Number.isFinite(l) || !Number.isFinite(t)) return;

        const pos = win.getPosition();
        const px = pos[0] ?? 0;
        const py = pos[1] ?? 0;
        if (!this.offset) {
            // Preserve wherever the user has the window right now.
            this.offset = { x: px - l!, y: py - t! };
            return;
        }
        const nx = l! + this.offset.x;
        const ny = t! + this.offset.y;
        if (px !== nx || py !== ny) win.setPosition(nx, ny);
    }
}
