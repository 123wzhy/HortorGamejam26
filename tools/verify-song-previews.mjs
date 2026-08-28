#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const expected = [
    {
        file: "neon-grid-demo-preview.wav",
        bpm: 100,
        beats: 16,
        sha256: "373db82157b6675f87d8845c8d30cc6c40f0b75335786e7d32f6fe06da9fde51"
    },
    {
        file: "golden-stampede-demo-preview.wav",
        bpm: 120,
        beats: 16,
        sha256: "644d78fe04e77e88c3410da2424fa546e0d3d311680e576ab23541568e068d8b"
    }
];

function fail(message) {
    throw new Error("song preview verification failed: " + message);
}

function fourCC(buffer, offset) {
    return buffer.toString("ascii", offset, offset + 4);
}

function readChunks(buffer) {
    const chunks = new Map();
    let offset = 12;
    while (offset + 8 <= buffer.length) {
        const id = fourCC(buffer, offset);
        const size = buffer.readUInt32LE(offset + 4);
        const dataStart = offset + 8;
        const dataEnd = dataStart + size;
        if (dataEnd > buffer.length) {
            fail(id + " chunk exceeds file bounds");
        }
        chunks.set(id, buffer.subarray(dataStart, dataEnd));
        offset = dataEnd + (size % 2);
    }
    return chunks;
}

function inspect(entry) {
    const path = join(projectRoot, "assets", "audio", "bgm", entry.file);
    const buffer = readFileSync(path);
    if (buffer.length < 44 || fourCC(buffer, 0) !== "RIFF" || fourCC(buffer, 8) !== "WAVE") {
        fail(entry.file + " is not a RIFF/WAVE file");
    }
    if (buffer.readUInt32LE(4) + 8 !== buffer.length) {
        fail(entry.file + " has an inconsistent RIFF length");
    }

    const chunks = readChunks(buffer);
    const format = chunks.get("fmt ");
    const data = chunks.get("data");
    if (!format || format.length < 16 || !data) {
        fail(entry.file + " is missing fmt/data chunks");
    }

    const audioFormat = format.readUInt16LE(0);
    const channels = format.readUInt16LE(2);
    const sampleRate = format.readUInt32LE(4);
    const byteRate = format.readUInt32LE(8);
    const blockAlign = format.readUInt16LE(12);
    const bitsPerSample = format.readUInt16LE(14);
    if (audioFormat !== 1 || channels !== 1 || sampleRate !== 22050 || bitsPerSample !== 16) {
        fail(entry.file + " must be mono 22050 Hz 16-bit PCM");
    }
    if (blockAlign !== 2 || byteRate !== sampleRate * blockAlign || data.length % blockAlign !== 0) {
        fail(entry.file + " has inconsistent PCM alignment");
    }

    const expectedDuration = entry.beats * 60 / entry.bpm;
    const duration = data.length / byteRate;
    if (Math.abs(duration - expectedDuration) > 1 / sampleRate) {
        fail(entry.file + " duration no longer follows its BPM/beat mapping");
    }

    let peak = 0;
    let nonZeroSamples = 0;
    for (let offset = 0; offset < data.length; offset += 2) {
        const sample = Math.abs(data.readInt16LE(offset));
        peak = Math.max(peak, sample);
        if (sample > 16) {
            nonZeroSamples += 1;
        }
    }
    if (peak < 1000 || nonZeroSamples < sampleRate * 0.25) {
        fail(entry.file + " is silent or effectively empty");
    }
    if (peak >= 32767) {
        fail(entry.file + " clips at full-scale PCM");
    }

    const digest = createHash("sha256").update(buffer).digest("hex");
    if (digest !== entry.sha256) {
        fail(entry.file + " differs from the deterministic generator output");
    }
    return { duration, peak, bytes: buffer.length };
}

const results = expected.map((entry) => ({ entry, result: inspect(entry) }));
console.log(
    "song-previews=ok "
    + results.map(({ entry, result }) => (
        entry.file + ":" + result.duration.toFixed(3) + "s/peak=" + result.peak + "/bytes=" + result.bytes
    )).join(" ")
);
