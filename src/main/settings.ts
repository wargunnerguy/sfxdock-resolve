// Local settings persistence (provider API keys, later: download folder,
// bin name, watched folders). Lives in the OS user-data dir — never in the
// repo. Plain JSON for Phase 2; OAuth tokens get keychain treatment in
// Phase 6 per CLAUDE.md.

import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

import type { ResultField, ResultFields } from '../shared/ipc';

interface SettingsShape {
    providerKeys: Record<string, string>;
    /** Freesound OAuth Client ID (its API key, stored as providerKeys.freesound, is the client secret). */
    freesoundClientId: string;
    binName: string;
    compact: boolean;
    followResolve: boolean;
    resultFields: ResultFields;
}

const DEFAULT_BIN = 'SFX';
// Quality + duration + source shown by default; uploader off (per maintainer).
const DEFAULT_FIELDS: ResultFields = { duration: true, quality: true, author: false, provider: true };
const DEFAULTS: SettingsShape = {
    providerKeys: {},
    freesoundClientId: '',
    binName: DEFAULT_BIN,
    compact: false,
    followResolve: false,
    resultFields: { ...DEFAULT_FIELDS },
};

class Settings {
    private file = path.join(app.getPath('userData'), 'sfxdock-settings.json');
    private data: SettingsShape = { ...DEFAULTS, providerKeys: {} };

    load(): void {
        try {
            const raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Partial<SettingsShape>;
            this.data = {
                ...DEFAULTS,
                ...raw,
                providerKeys: { ...raw.providerKeys },
                resultFields: { ...DEFAULT_FIELDS, ...raw.resultFields },
            };
        } catch {
            this.data = { ...DEFAULTS, providerKeys: {}, resultFields: { ...DEFAULT_FIELDS } };
        }
    }

    getFreesoundClientId(): string {
        return this.data.freesoundClientId ?? '';
    }

    setFreesoundClientId(id: string): void {
        this.data.freesoundClientId = id.trim();
        this.save();
    }

    getResultFields(): ResultFields {
        return { ...this.data.resultFields };
    }

    setResultField(field: ResultField, show: boolean): ResultFields {
        this.data.resultFields = { ...this.data.resultFields, [field]: show };
        this.save();
        return this.getResultFields();
    }

    getBinName(): string {
        return this.data.binName || DEFAULT_BIN;
    }

    setBinName(name: string): void {
        this.data.binName = name.trim() || DEFAULT_BIN;
        this.save();
    }

    getCompact(): boolean {
        return this.data.compact === true;
    }

    setCompact(compact: boolean): void {
        this.data.compact = compact;
        this.save();
    }

    getFollowResolve(): boolean {
        return this.data.followResolve === true;
    }

    setFollowResolve(follow: boolean): void {
        this.data.followResolve = follow;
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
