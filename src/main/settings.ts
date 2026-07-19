// Local settings persistence (provider API keys, later: download folder,
// bin name, watched folders). Lives in the OS user-data dir — never in the
// repo. Plain JSON for Phase 2; OAuth tokens get keychain treatment in
// Phase 6 per CLAUDE.md.

import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

interface SettingsShape {
    providerKeys: Record<string, string>;
    binName: string;
}

const DEFAULT_BIN = 'SFX';
const DEFAULTS: SettingsShape = { providerKeys: {}, binName: DEFAULT_BIN };

class Settings {
    private file = path.join(app.getPath('userData'), 'sfxdock-settings.json');
    private data: SettingsShape = { ...DEFAULTS, providerKeys: {} };

    load(): void {
        try {
            const raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Partial<SettingsShape>;
            this.data = { ...DEFAULTS, ...raw, providerKeys: { ...raw.providerKeys } };
        } catch {
            this.data = { ...DEFAULTS, providerKeys: {} };
        }
    }

    getBinName(): string {
        return this.data.binName || DEFAULT_BIN;
    }

    setBinName(name: string): void {
        this.data.binName = name.trim() || DEFAULT_BIN;
        this.save();
    }

    private save(): void {
        fs.mkdirSync(path.dirname(this.file), { recursive: true });
        fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
    }

    getProviderKey(providerId: string): string | null {
        return this.data.providerKeys[providerId] ?? null;
    }

    setProviderKey(providerId: string, key: string): void {
        const trimmed = key.trim();
        if (trimmed === '') {
            delete this.data.providerKeys[providerId];
        } else {
            this.data.providerKeys[providerId] = trimmed;
        }
        this.save();
    }

    /** Which providers have a key set — booleans only, keys never cross IPC. */
    keyStatus(providerIds: string[]): Record<string, boolean> {
        return Object.fromEntries(providerIds.map((id) => [id, this.getProviderKey(id) !== null]));
    }
}

export const settings = new Settings();
