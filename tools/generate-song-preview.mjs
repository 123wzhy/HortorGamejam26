#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const SAMPLE_RATE = 22050;
const MAX_AMPLITUDE = 32767;

function usage(message = "") {
    if (message) {
        console.error("error: " + message);
    }
    console.error(
        "usage: node tools/generate-song-preview.mjs "
        + "--output <preview.wav> --bpm <60..220> --style <neon|stampede> [--beats <8..32>]"
    );
    process.exit(1);
}

function parseArgs(argv) {
    const parsed = { output: "", bpm: 0, style: "", beats: 16 };
    for (let index = 0; index < argv.length; index += 2) {
        const key = argv[index];
        const value = argv[index + 1];
        if (!key || !value || !key.startsWith("--")) {
            usage("arguments must use --key value pairs");
        }
        if (key === "--output") parsed.output = value;
        else if (key === "--bpm") parsed.bpm = Number(value);
        else if (key === "--style") parsed.style = value;
        else if (key === "--beats") parsed.beats = Number(value);
        else usage("unknown argument " + key);
    }
    if (!parsed.output) usage("--output is required");
    if (!Number.isFinite(parsed.bpm) || parsed.bpm < 60 || parsed.bpm > 220) {
        usage("--bpm must be between 60 and 220");
    }
    if (parsed.style !== "neon" && parsed.style !== "stampede") {
        usage("--style must be neon or stampede");
    }
    if (!Number.isInteger(parsed.beats) || parsed.beats < 8 || parsed.beats > 32) {
        usage("--beats must be an integer between 8 and 32");
    }
    return parsed;
}

function seededNoise(sampleIndex, salt) {
    let value = (sampleIndex + 1 + salt * 1013) | 0;
    value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
    value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
    value ^= value >>> 16;
    return ((value >>> 0) / 0xffffffff) * 2 - 1;
}

function envelope(phaseSeconds, decay) {
    return phaseSeconds >= 0 ? Math.exp(-phaseSeconds * decay) : 0;
}

function oscillator(frequency, timeSeconds, harmonic = 0) {
    const fundamental = Math.sin(Math.PI * 2 * frequency * timeSeconds);
    const overtone = Math.sin(Math.PI * 4 * frequency * timeSeconds) * harmonic;
    return (fundamental + overtone) / (1 + Math.abs(harmonic));
}

function synthSample(style, bpm, beatCount, sampleIndex) {
    const timeSeconds = sampleIndex / SAMPLE_RATE;
    const beatSeconds = 60 / bpm;
    const beatPosition = timeSeconds / beatSeconds;
    const beatIndex = Math.min(beatCount - 1, Math.floor(beatPosition));
    const beatPhase = (beatPosition - beatIndex) * beatSeconds;
    const halfBeatPosition = beatPosition * 2;
    const halfBeatIndex = Math.floor(halfBeatPosition);
    const halfBeatPhase = (halfBeatPosition - halfBeatIndex) * beatSeconds * 0.5;
    const measureBeat = beatIndex % 4;

    const kickFrequency = style === "stampede" ? 54 : 68;
    const kick = oscillator(kickFrequency + 34 * envelope(beatPhase, 20), beatPhase)
        * envelope(beatPhase, style === "stampede" ? 7 : 10)
        * (measureBeat === 0 ? 0.78 : 0.48);

    const snarePhase = measureBeat === 2 ? beatPhase : -1;
    const snare = seededNoise(sampleIndex, 7) * envelope(snarePhase, 17) * 0.22;
    const hat = seededNoise(sampleIndex, 17) * envelope(halfBeatPhase, 62)
        * (halfBeatIndex % 2 === 0 ? 0.09 : 0.055);

    const neonScale = [220, 277.18, 329.63, 440, 329.63, 277.18, 246.94, 329.63];
    const stampedeScale = [110, 146.83, 164.81, 130.81, 110, 196, 164.81, 146.83];
    const scale = style === "stampede" ? stampedeScale : neonScale;
    const noteFrequency = scale[beatIndex % scale.length];
    const noteEnvelope = envelope(beatPhase, style === "stampede" ? 2.8 : 4.8);
    const lead = oscillator(noteFrequency, timeSeconds, style === "stampede" ? 0.22 : 0.38)
        * noteEnvelope
        * (style === "stampede" ? 0.29 : 0.24);
    const bass = oscillator(noteFrequency * 0.5, timeSeconds, 0.12)
        * envelope(beatPhase, 2.1)
        * 0.2;

    const mix = kick + snare + hat + lead + bass;
    return Math.max(-1, Math.min(1, mix * 0.78));
}

function makeWav(options) {
    const beatSeconds = 60 / options.bpm;
    const durationSeconds = options.beats * beatSeconds;
    const sampleCount = Math.ceil(durationSeconds * SAMPLE_RATE);
    const pcmBytes = sampleCount * 2;
    const output = Buffer.alloc(44 + pcmBytes);
    output.write("RIFF", 0);
    output.writeUInt32LE(36 + pcmBytes, 4);
    output.write("WAVE", 8);
    output.write("fmt ", 12);
    output.writeUInt32LE(16, 16);
    output.writeUInt16LE(1, 20);
    output.writeUInt16LE(1, 22);
    output.writeUInt32LE(SAMPLE_RATE, 24);
    output.writeUInt32LE(SAMPLE_RATE * 2, 28);
    output.writeUInt16LE(2, 32);
    output.writeUInt16LE(16, 34);
    output.write("data", 36);
    output.writeUInt32LE(pcmBytes, 40);

    const fadeSamples = Math.min(Math.floor(SAMPLE_RATE * 0.06), sampleCount);
    for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
        let sample = synthSample(options.style, options.bpm, options.beats, sampleIndex);
        if (sampleIndex >= sampleCount - fadeSamples) {
            sample *= (sampleCount - sampleIndex - 1) / Math.max(1, fadeSamples);
        }
        output.writeInt16LE(Math.round(sample * MAX_AMPLITUDE), 44 + sampleIndex * 2);
    }
    return { output, durationSeconds };
}

const options = parseArgs(process.argv.slice(2));
const generated = makeWav(options);
fs.mkdirSync(path.dirname(path.resolve(options.output)), { recursive: true });
fs.writeFileSync(options.output, generated.output);
console.log("preview-audio=generated");
console.log("output=" + path.resolve(options.output));
console.log("style=" + options.style);
console.log("bpm=" + options.bpm);
console.log("beats=" + options.beats);
console.log("duration-seconds=" + generated.durationSeconds.toFixed(3));
console.log("bytes=" + generated.output.length);
