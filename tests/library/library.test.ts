import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Library } from '../../src/library/library';
import type { NewDownload } from '../../src/library/types';

function sampleDownload(over: Partial<NewDownload> = {}): NewDownload {
    return {
        providerId: 'freesound',
        sourceId: '440261',
        title: 'Door Slam',
        author: 'adriann',
        licenseId: 'CC0-1.0',
        licenseName: 'CC0 1.0 (Public Domain)',
        licenseUrl: 'http://creativecommons.org/publicdomain/zero/1.0/',
        attribution: '"Door Slam" by adriann on Freesound',
        attributionRequired: false,
        tags: 'door slam impact',
        originalQuery: 'door slam',
        filePath: 'C:/sfx/door.wav',
        durationSec: 4.19,
        format: 'wav',
        contentType: 'sfx',
        ...over,
    };
}

describe('Library downloads + dedupe', () => {
    let lib: Library;
    beforeEach(() => {
        lib = new Library(':memory:');
    });
    afterEach(() => lib.close());

    it('records a download and reports ownership by source', () => {
        expect(lib.isOwned('freesound', '440261')).toBe(false);
        const rec = lib.recordDownload(sampleDownload());
        expect(rec.id).toBeGreaterThan(0);
        expect(lib.isOwned('freesound', '440261')).toBe(true);
        expect(lib.isOwned('freesound', 'other')).toBe(false);
    });

    it('dedupes on (provider, source): a second record updates rather than duplicates', () => {
        lib.recordDownload(sampleDownload());
        lib.recordDownload(sampleDownload({ filePath: 'C:/sfx/door-2.wav' }));
        const rec = lib.getDownloadBySource('freesound', '440261');
        expect(rec?.filePath).toBe('C:/sfx/door-2.wav');
        expect(lib.searchLocal('door').length).toBe(1);
    });

    it('records per-project imports and lists them in import order', () => {
        const a = lib.recordDownload(sampleDownload({ sourceId: 'a', title: 'A' }));
        const b = lib.recordDownload(sampleDownload({ sourceId: 'b', title: 'B' }));
        lib.recordDownload(sampleDownload({ sourceId: 'c', title: 'C' })); // never imported
        lib.recordImport('proj-1', a.id);
        lib.recordImport('proj-1', b.id);
        lib.recordImport('proj-2', b.id);
        expect(lib.importsForProject('proj-1').map((d) => d.title)).toEqual(['A', 'B']);
        expect(lib.importsForProject('proj-2').map((d) => d.title)).toEqual(['B']);
        expect(lib.importsForProject('proj-unknown')).toHaveLength(0);
    });

    it('a repeated import into the same project is idempotent', () => {
        const a = lib.recordDownload(sampleDownload());
        lib.recordImport('proj-1', a.id);
        lib.recordImport('proj-1', a.id);
        expect(lib.importsForProject('proj-1')).toHaveLength(1);
    });

    it('lists only attribution-required downloads', () => {
        lib.recordDownload(sampleDownload()); // CC0, not required
        lib.recordDownload(
            sampleDownload({
                providerId: 'jamendo',
                sourceId: '1',
                title: 'Song',
                attributionRequired: true,
                contentType: 'music',
            }),
        );
        const attrs = lib.attributions();
        expect(attrs).toHaveLength(1);
        expect(attrs[0]!.title).toBe('Song');
    });
});

describe('Library local search + content filter', () => {
    let lib: Library;
    beforeEach(() => {
        lib = new Library(':memory:');
    });
    afterEach(() => lib.close());

    it('matches downloads by tokenized title/tags and filters by content type', () => {
        lib.recordDownload(sampleDownload());
        lib.recordDownload(
            sampleDownload({ providerId: 'jamendo', sourceId: 'm1', title: 'Jazz Loop', tags: 'jazz music', originalQuery: 'jazz', contentType: 'music' }),
        );
        expect(lib.searchLocal('door').map((h) => h.title)).toEqual(['Door Slam']);
        expect(lib.searchLocal('jazz', 'music').map((h) => h.title)).toEqual(['Jazz Loop']);
        expect(lib.searchLocal('jazz', 'sfx')).toHaveLength(0);
        expect(lib.searchLocal('slam', 'sfx').map((h) => h.title)).toEqual(['Door Slam']);
    });

    it('requires all query tokens to match', () => {
        lib.recordDownload(sampleDownload({ title: 'Heavy Door Slam' }));
        expect(lib.searchLocal('heavy slam')).toHaveLength(1);
        expect(lib.searchLocal('heavy whoosh')).toHaveLength(0);
    });
});

describe('Library watched folders + rescan', () => {
    let lib: Library;
    let tmp: string;
    beforeEach(() => {
        lib = new Library(':memory:');
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sfxdock-lib-'));
    });
    afterEach(() => {
        lib.close();
        fs.rmSync(tmp, { recursive: true, force: true });
    });

    it('registers a non-removable downloads folder that cannot be removed', () => {
        lib.ensureDownloadsFolder(tmp);
        const folders = lib.listWatchedFolders();
        expect(folders).toHaveLength(1);
        expect(folders[0]!.removable).toBe(false);
        expect(lib.removeWatchedFolder(folders[0]!.id)).toBe(false);
    });

    it('indexes audio files by filename and finds them; ignores non-audio', () => {
        fs.writeFileSync(path.join(tmp, 'Thunder Rumble.wav'), 'x');
        fs.writeFileSync(path.join(tmp, 'notes.txt'), 'x');
        fs.mkdirSync(path.join(tmp, 'sub'));
        fs.writeFileSync(path.join(tmp, 'sub', 'rain-loop.mp3'), 'x');
        lib.addWatchedFolder(tmp);
        const res = lib.rescan();
        expect(res.added).toBe(2);
        expect(lib.searchLocal('thunder').map((h) => h.title)).toEqual(['Thunder Rumble.wav']);
        expect(lib.searchLocal('rain').map((h) => h.title)).toEqual(['rain-loop.mp3']);
        expect(lib.searchLocal('notes')).toHaveLength(0);
    });

    it('a rescan reflects added and removed files', () => {
        const f = path.join(tmp, 'a.wav');
        fs.writeFileSync(f, 'x');
        lib.addWatchedFolder(tmp);
        expect(lib.rescan().added).toBe(1);
        fs.rmSync(f);
        fs.writeFileSync(path.join(tmp, 'b.wav'), 'x');
        const res = lib.rescan();
        expect(res.added).toBe(1);
        expect(lib.searchLocal('a')).toHaveLength(0);
        expect(lib.searchLocal('b').map((h) => h.title)).toEqual(['b.wav']);
    });

    it('reads sample rate + bit depth from a real WAV header into the quality label', () => {
        // Minimal 44.1kHz / 16-bit / mono WAV with a tiny data chunk.
        const sampleRate = 44100;
        const buf = Buffer.alloc(44 + 8);
        buf.write('RIFF', 0);
        buf.writeUInt32LE(36 + 8, 4);
        buf.write('WAVE', 8);
        buf.write('fmt ', 12);
        buf.writeUInt32LE(16, 16);
        buf.writeUInt16LE(1, 20);
        buf.writeUInt16LE(1, 22);
        buf.writeUInt32LE(sampleRate, 24);
        buf.writeUInt32LE(sampleRate * 2, 28);
        buf.writeUInt16LE(2, 32);
        buf.writeUInt16LE(16, 34);
        buf.write('data', 36);
        buf.writeUInt32LE(8, 40);
        fs.writeFileSync(path.join(tmp, 'Real Tone.wav'), buf);
        lib.addWatchedFolder(tmp);
        lib.rescan();
        expect(lib.searchLocal('real')[0]!.quality).toBe('44.1kHz · 16-bit · WAV');
    });

    it('removing a watched folder drops its indexed files', () => {
        fs.writeFileSync(path.join(tmp, 'gone.wav'), 'x');
        const folder = lib.addWatchedFolder(tmp)!;
        lib.rescan();
        expect(lib.searchLocal('gone')).toHaveLength(1);
        expect(lib.removeWatchedFolder(folder.id)).toBe(true);
        expect(lib.searchLocal('gone')).toHaveLength(0);
    });

    it('a download coexisting with a watched copy of the same file is not double-listed', () => {
        const f = path.join(tmp, 'door.wav');
        fs.writeFileSync(f, 'x');
        lib.addWatchedFolder(tmp);
        lib.rescan();
        lib.recordDownload(sampleDownload({ title: 'door', filePath: f }));
        const hits = lib.searchLocal('door');
        expect(hits).toHaveLength(1);
        expect(hits[0]!.soundId).toBe('freesound:440261'); // the rich download wins
    });
});
