// Cheap, header-only duration extraction for v1 filename-level indexing.
// WAV/AIFF durations come straight from the header (no decode). Everything
// else returns null — the player reads real duration on load, and the
// waveform is client-rendered anyway.

import fs from 'node:fs';

const AUDIO_EXTENSIONS = new Set(['.wav', '.wave', '.aif', '.aiff', '.mp3', '.ogg', '.flac', '.m4a', '.aac', '.opus']);

export function isAudioFile(filePath: string): boolean {
    const dot = filePath.lastIndexOf('.');
    if (dot < 0) return false;
    return AUDIO_EXTENSIONS.has(filePath.slice(dot).toLowerCase());
}

export function formatOf(filePath: string): string {
    const dot = filePath.lastIndexOf('.');
    return dot < 0 ? '' : filePath.slice(dot + 1).toLowerCase();
}

/** Returns duration in seconds for WAV/AIFF via header math, else null. */
export function readDurationSec(filePath: string): number | null {
    try {
        const fd = fs.openSync(filePath, 'r');
        try {
            const head = Buffer.alloc(64);
            const read = fs.readSync(fd, head, 0, 64, 0);
            if (read < 12) return null;
            const riff = head.toString('ascii', 0, 4);
            if (riff === 'RIFF' && head.toString('ascii', 8, 12) === 'WAVE') {
                return readWavDuration(fd);
            }
            if (riff === 'FORM' && head.toString('ascii', 8, 12).startsWith('AIF')) {
                return readAiffDuration(fd);
            }
            return null;
        } finally {
            fs.closeSync(fd);
        }
    } catch {
        return null;
    }
}

// Walk RIFF chunks for fmt (sample rate, channels, bits) and data (size).
function readWavDuration(fd: number): number | null {
    const size = fs.fstatSync(fd).size;
    let offset = 12;
    let byteRate = 0;
    let dataBytes = 0;
    const chunkHeader = Buffer.alloc(8);
    while (offset + 8 <= size) {
        if (fs.readSync(fd, chunkHeader, 0, 8, offset) < 8) break;
        const id = chunkHeader.toString('ascii', 0, 4);
        const chunkSize = chunkHeader.readUInt32LE(4);
        if (id === 'fmt ') {
            const fmt = Buffer.alloc(16);
            fs.readSync(fd, fmt, 0, 16, offset + 8);
            byteRate = fmt.readUInt32LE(8);
        } else if (id === 'data') {
            dataBytes = chunkSize;
        }
        offset += 8 + chunkSize + (chunkSize % 2);
    }
    if (byteRate > 0 && dataBytes > 0) return dataBytes / byteRate;
    return null;
}

function readAiffDuration(fd: number): number | null {
    const size = fs.fstatSync(fd).size;
    let offset = 12;
    const chunkHeader = Buffer.alloc(8);
    while (offset + 8 <= size) {
        if (fs.readSync(fd, chunkHeader, 0, 8, offset) < 8) break;
        const id = chunkHeader.toString('ascii', 0, 4);
        const chunkSize = chunkHeader.readUInt32BE(4);
        if (id === 'COMM') {
            const comm = Buffer.alloc(18);
            fs.readSync(fd, comm, 0, 18, offset + 8);
            const numFrames = comm.readUInt32BE(2);
            const sampleRate = read80BitFloat(comm.subarray(8, 18));
            if (sampleRate > 0) return numFrames / sampleRate;
            return null;
        }
        offset += 8 + chunkSize + (chunkSize % 2);
    }
    return null;
}

// AIFF stores sample rate as an 80-bit IEEE extended float.
function read80BitFloat(buf: Buffer): number {
    const exponent = ((buf[0]! & 0x7f) << 8) | buf[1]!;
    let mantissa = 0;
    for (let i = 2; i < 10; i++) mantissa = mantissa * 256 + buf[i]!;
    if (exponent === 0 && mantissa === 0) return 0;
    return mantissa * Math.pow(2, exponent - 16383 - 63);
}
