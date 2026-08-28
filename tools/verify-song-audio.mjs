#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const maximumFileBytes = 32 * 1024 * 1024;
const expected = [
    {
        file: "feng-wu-jiu-tian.mp3",
        bytes: 9599296,
        frames: 22966,
        finalFrameBytes: 218,
        durationSec: 599.928125,
        title: "凤舞九天劲速汽车音响劲爆英文舞曲串烧",
        artist: "凤舞九天",
        sha256: "d99f490094a51f459bf26a73c36c3d213086c2228067d8912972521e6dd1b7a7"
    },
    {
        file: "zhu-zhu-xia.mp3",
        bytes: 3496004,
        frames: 8363,
        finalFrameBytes: 418,
        durationSec: 218.462,
        title: "猪猪侠",
        artist: "陈洁丽",
        sha256: "5d6cf604eaaf5a59f81cd15698beff7a346b84120bb03c8722054efb85dad5d5"
    },
    {
        file: "are-you-ok.mp3",
        bytes: 2125542,
        frames: 5084,
        finalFrameBytes: 418,
        durationSec: 132.8065,
        title: "Are You OK",
        artist: "雷军",
        sha256: "6075615f7adaa5ce050ec978a004934982854a11fb26c358381146f302a7d0ee"
    }
];

function fail(message) {
    throw new Error("song audio verification failed: " + message);
}

function synchsafe(buffer, offset) {
    const bytes = [buffer[offset], buffer[offset + 1], buffer[offset + 2], buffer[offset + 3]];
    if (bytes.some((value) => value >= 0x80)) {
        fail("invalid ID3 synchsafe size");
    }
    return bytes.reduce((value, next) => value * 128 + next, 0);
}

function decodeUtf16BigEndian(buffer) {
    if (buffer.length % 2 !== 0) {
        fail("odd UTF-16BE text frame length");
    }
    const swapped = Buffer.alloc(buffer.length);
    for (let offset = 0; offset < buffer.length; offset += 2) {
        swapped[offset] = buffer[offset + 1];
        swapped[offset + 1] = buffer[offset];
    }
    return swapped.toString("utf16le");
}

function decodeTextFrame(payload) {
    if (!payload.length) {
        return "";
    }
    const encoding = payload[0];
    let text = "";
    const content = payload.subarray(1);
    if (encoding === 0) {
        text = content.toString("latin1");
    } else if (encoding === 1) {
        if (content.length < 2) {
            fail("UTF-16 text frame is missing its BOM");
        }
        if (content[0] === 0xff && content[1] === 0xfe) {
            text = content.subarray(2).toString("utf16le");
        } else if (content[0] === 0xfe && content[1] === 0xff) {
            text = decodeUtf16BigEndian(content.subarray(2));
        } else {
            fail("UTF-16 text frame has no recognized BOM");
        }
    } else if (encoding === 2) {
        text = decodeUtf16BigEndian(content);
    } else if (encoding === 3) {
        text = content.toString("utf8");
    } else {
        fail("unsupported ID3 text encoding " + encoding);
    }
    return text.replace(/^\uFEFF/, "").replace(/\u0000+$/g, "");
}

function inspectId3(buffer, file) {
    if (buffer.toString("ascii", 0, 3) !== "ID3") {
        fail(file + " is missing ID3v2");
    }
    if (buffer[3] !== 3 || buffer[4] !== 0) {
        fail(file + " must retain ID3v2.3.0");
    }
    if ((buffer[5] & 0x40) !== 0) {
        fail(file + " uses an unsupported extended ID3 header");
    }
    const tagEnd = 10 + synchsafe(buffer, 6);
    if (tagEnd > buffer.length) {
        fail(file + " ID3 tag exceeds file bounds");
    }
    const frames = new Map();
    let offset = 10;
    while (offset + 10 <= tagEnd) {
        const id = buffer.toString("ascii", offset, offset + 4);
        if (/^\u0000{4}$/.test(id)) {
            break;
        }
        if (!/^[A-Z0-9]{4}$/.test(id)) {
            fail(file + " has invalid ID3 frame id at " + offset);
        }
        const size = buffer.readUInt32BE(offset + 4);
        const dataStart = offset + 10;
        const dataEnd = dataStart + size;
        if (dataEnd > tagEnd) {
            fail(file + " ID3 frame " + id + " exceeds tag bounds");
        }
        frames.set(id, buffer.subarray(dataStart, dataEnd));
        offset = dataEnd;
    }
    const title = frames.has("TIT2") ? decodeTextFrame(frames.get("TIT2")) : "";
    const artist = frames.has("TPE1") ? decodeTextFrame(frames.get("TPE1")) : "";
    return { tagEnd, title, artist };
}

const mpeg1Layer3Bitrates = [
    0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0
];
const mpeg1SampleRates = [44100, 48000, 32000, 0];

function inspectFrameHeader(buffer, offset, file) {
    if (offset + 4 > buffer.length) {
        fail(file + " has a truncated MPEG frame header");
    }
    const header = buffer.readUInt32BE(offset) >>> 0;
    if (((header >>> 21) & 0x7ff) !== 0x7ff) {
        fail(file + " lost MPEG frame sync at byte " + offset);
    }
    const version = (header >>> 19) & 0x3;
    const layer = (header >>> 17) & 0x3;
    const protectionBit = (header >>> 16) & 0x1;
    const bitrateKbps = mpeg1Layer3Bitrates[(header >>> 12) & 0xf];
    const sampleRate = mpeg1SampleRates[(header >>> 10) & 0x3];
    const padding = (header >>> 9) & 0x1;
    const channelMode = (header >>> 6) & 0x3;
    if (version !== 3 || layer !== 1 || bitrateKbps !== 128 || sampleRate !== 44100) {
        fail(file + " must be MPEG-1 Layer III, 128 kbps, 44.1 kHz");
    }
    if (channelMode === 3) {
        fail(file + " must remain stereo rather than mono");
    }
    return {
        protectionBit,
        bitrateKbps,
        sampleRate,
        channelMode,
        length: Math.floor(144000 * bitrateKbps / sampleRate) + padding
    };
}

function inspect(entry) {
    const path = join(projectRoot, "assets", "audio", "bgm", entry.file);
    const buffer = readFileSync(path);
    if (buffer.length !== entry.bytes || buffer.length >= maximumFileBytes) {
        fail(entry.file + " has an unexpected size or exceeds the 32 MiB limit");
    }
    const digest = createHash("sha256").update(buffer).digest("hex");
    if (digest !== entry.sha256) {
        fail(entry.file + " SHA-256 differs from the audited source");
    }

    const id3 = inspectId3(buffer, entry.file);
    if (id3.title !== entry.title || id3.artist !== entry.artist) {
        fail(entry.file + " ID3 title/artist changed");
    }
    const firstHeader = inspectFrameHeader(buffer, id3.tagEnd, entry.file);
    const sideInfoBytes = firstHeader.channelMode === 3 ? 17 : 32;
    const infoOffset = id3.tagEnd + 4 + (firstHeader.protectionBit === 0 ? 2 : 0) + sideInfoBytes;
    const infoId = buffer.toString("ascii", infoOffset, infoOffset + 4);
    if (infoId !== "Info" && infoId !== "Xing") {
        fail(entry.file + " is missing its deterministic Info/Xing frame count");
    }
    const infoFlags = buffer.readUInt32BE(infoOffset + 4);
    if ((infoFlags & 0x1) === 0) {
        fail(entry.file + " Info/Xing header has no frame count");
    }
    const frameCount = buffer.readUInt32BE(infoOffset + 8);
    if (frameCount !== entry.frames) {
        fail(entry.file + " frame count changed");
    }

    let frameOffset = id3.tagEnd;
    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
        const header = inspectFrameHeader(buffer, frameOffset, entry.file);
        frameOffset += header.length;
    }
    const id3v1Offset = buffer.length - 128;
    if (buffer.toString("ascii", id3v1Offset, id3v1Offset + 3) !== "TAG") {
        fail(entry.file + " is missing its trailing ID3v1 tag");
    }
    const finalFrameHeader = inspectFrameHeader(buffer, frameOffset, entry.file);
    const finalFrameBytes = id3v1Offset - frameOffset;
    if (finalFrameBytes !== entry.finalFrameBytes
        || finalFrameBytes <= 0
        || finalFrameBytes > finalFrameHeader.length) {
        fail(entry.file + " final encoded audio frame span changed");
    }

    const durationSec = frameCount * 1152 / firstHeader.sampleRate;
    if (Math.abs(durationSec - entry.durationSec) > 0.001) {
        fail(entry.file + " duration changed");
    }
    const meta = JSON.parse(readFileSync(path + ".meta", "utf8"));
    if (meta.importer !== "audio-clip" || meta.downloadMode !== 0
        || Math.abs(Number(meta.duration) - entry.durationSec) > 0.001) {
        fail(entry.file + ".meta no longer matches the audited audio");
    }
    return { durationSec, frameCount, bytes: buffer.length };
}

const results = expected.map((entry) => ({ entry, result: inspect(entry) }));
console.log(
    "song-audio=ok "
    + results.map(({ entry, result }) => (
        entry.file + ":" + result.durationSec.toFixed(3) + "s/frames="
        + result.frameCount + "/bytes=" + result.bytes
    )).join(" ")
);
