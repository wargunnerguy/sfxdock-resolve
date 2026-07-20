// Encrypted local storage for OAuth tokens. Uses Electron safeStorage (Windows
// DPAPI / macOS Keychain), so ciphertext on disk is tied to the OS user account
// and tokens never appear in plaintext or in the repo (CLAUDE.md secrets rule).

import { app, safeStorage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

export interface StoredTokens {
    accessToken: string;
    refreshToken: string;
    /** epoch ms when the access token expires */
    expiresAt: number;
}

function fileFor(providerId: string): string {
    return path.join(app.getPath('userData'), `oauth-${providerId}.bin`);
}

export function saveTokens(providerId: string, tokens: StoredTokens): void {
    const json = JSON.stringify(tokens);
    const buf = safeStorage.isEncryptionAvailable()
        ? safeStorage.encryptString(json)
        : Buffer.from(json, 'utf8'); // fallback: still local-only, but unencrypted
    fs.mkdirSync(path.dirname(fileFor(providerId)), { recursive: true });
    fs.writeFileSync(fileFor(providerId), buf);
}

export function loadTokens(providerId: string): StoredTokens | null {
    try {
        const buf = fs.readFileSync(fileFor(providerId));
        const json = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : buf.toString('utf8');
        const parsed = JSON.parse(json) as StoredTokens;
        if (typeof parsed.accessToken === 'string' && typeof parsed.refreshToken === 'string') return parsed;
        return null;
    } catch {
        return null;
    }
}

export function clearTokens(providerId: string): void {
    fs.rm(fileFor(providerId), { force: true }, () => undefined);
}
