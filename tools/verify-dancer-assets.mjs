import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
    DANCER_CLIP_SOURCES,
    DANCER_SOURCE_NAMES,
    EXPECTED_DANCER_FBX_SHA256,
    ORIGINAL_DANCER_MODEL_FACTS,
    ORIGINAL_DANCER_TEXTURE_FACTS,
    assertExpectedSourceHashes,
    assertIdleAliasPolicy,
    assertOriginalModelFacts
} from "./dancer-source-policy.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, "..");
const RUNTIME_DIR = path.join(PROJECT_ROOT, "assets", "spine", "runtime");
const IMPORT_DIR = path.join(PROJECT_ROOT, "assets", "spine", "import");
const GLTF_PATH = path.join(RUNTIME_DIR, "BullDancer.gltf");
const GLTF_META_PATH = GLTF_PATH + ".meta";
const BIN_PATH = path.join(IMPORT_DIR, "BullDancer.bin");
const JPG_PATH = path.join(RUNTIME_DIR, ORIGINAL_DANCER_TEXTURE_FACTS.runtimeName);
const SOURCE_DIR = path.join(PROJECT_ROOT, "source-assets", "dancer");

const EXPECTED_FILES = {
    "BullDancer.gltf": {
        bytes: 69033,
        sha256: "6801bc4da322396b3e6ea3b25c183a08704131c2ae90ec15ac8c69db47c3aae5"
    },
    "OriginalDancerAlbedo.jpg": {
        bytes: ORIGINAL_DANCER_TEXTURE_FACTS.runtimeBytes,
        sha256: ORIGINAL_DANCER_TEXTURE_FACTS.runtimeSha256
    }
};

const EXPECTED_IMPORT_BUFFER = {
    bytes: 2718976,
    sha256: "66838470bd81b538f55b434119d319f0eb41b3e717fce21ce72242e1c7a9a8b2"
};

const EXPECTED_BASE_BUFFER_PREFIX = {
    bytes: 1731096,
    sha256: "c8858498b8482bfc1b7bf1709c4daed103989128cfcee0396432c589bf40a146"
};

const EXPECTED_ANIMATIONS = {
    IdleSway: 1.0416666269302368,
    DanceCombo: 26.79166603088379,
    ResultPose: 12.458333015441895,
    DanceCombo2: 20.45833396911621,
    ResultPose2: 18.79166603088379,
    ResultPose3: 3.8333332538604736,
    IdleSway0: 1.0416666269302368
};

const EXPECTED_HIPS_RELATIVE_MOTION = {
    DanceCombo: [-0.0568898979, 0.0510178208, 0.0043864433],
    DanceCombo2: [0.2411682618, 0.0313188434, -0.0179434017],
    ResultPose: [-0.1114851969, 0.322083652, 0.0704337723],
    ResultPose2: [0.6528811467, 0.006064117, -0.2514213108],
    ResultPose3: [-0.7343015659, 0.2726812959, 1.1239930011],
    IdleSway0: [-0.0031579397, -0.0094211102, 0.0070317398]
};

const EXPECTED_RETARGET_ANIMATIONS = {
    DanceCombo: {
        channelCount: 35,
        sourceRawGltfSha256: "17b8ff13767ec54124af373172a021ac55692465d281fafe380b4d668bb42ade",
        sourceRawBinarySha256: "a09ff50aea935c4ca343c9f8f7b00dd329b835960cdd04e2db0807c95a879815"
    },
    DanceCombo2: {
        channelCount: 25,
        sourceRawGltfSha256: "d22cce7fe39050af4d4bceb6811feec9b4b86d893c5ab7a7e572508a96b86948",
        sourceRawBinarySha256: "4e8d15d32aa166defa471ff83c13717f131e112acd4b3349e3648740d5c70725"
    },
    ResultPose: {
        channelCount: 30,
        sourceRawGltfSha256: "eb36ef9882d130558012da7c6a65ef583125001b31a478c4322b7400638b4d85",
        sourceRawBinarySha256: "2ea7db8c4f021de5b17c01b9edb428b35339815c1738b2484d32f95d6f7e3598"
    },
    ResultPose2: {
        channelCount: 36,
        sourceRawGltfSha256: "6225a7d23005345245d8be3a593f75626dadbcb67af1d30887373f337bfaf923",
        sourceRawBinarySha256: "68f04c58fd88fa40a44f12c418a121c97faf4e312a45d0d1d99819529b1f1af2"
    },
    ResultPose3: {
        channelCount: 29,
        sourceRawGltfSha256: "b2e92fd1b22fedc6f8c2e7d5c4f4a8c99ed2ce55321afc65a16331c59552638c",
        sourceRawBinarySha256: "d3ff13e71dac16ad267d00609536bc817c340413402e9002a687ed15a1c6dbf4"
    }
};

const EXPECTED_CREATOR_IMPORT = {
    IdleSway: { maxFrameCount: 26, totalFrameCount: 769 },
    DanceCombo: { maxFrameCount: 644, totalFrameCount: 13533 },
    ResultPose: { maxFrameCount: 300, totalFrameCount: 6281 },
    DanceCombo2: { maxFrameCount: 492, totalFrameCount: 10337 },
    ResultPose2: { maxFrameCount: 452, totalFrameCount: 9519 },
    ResultPose3: { maxFrameCount: 93, totalFrameCount: 1969 },
    IdleSway0: { maxFrameCount: 26, totalFrameCount: 769 }
};

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

function sha256(buffer) {
    return crypto.createHash("sha256").update(buffer).digest("hex");
}

function animationDuration(gltf, animation) {
    return (animation.samplers || []).reduce((maximum, sampler) => {
        const accessor = gltf.accessors && gltf.accessors[sampler.input];
        const endTime = accessor && accessor.max && accessor.max[0];
        return typeof endTime === "number" ? Math.max(maximum, endTime) : maximum;
    }, 0);
}

function assertNoExtensions(value, location = "gltf") {
    if (!value || typeof value !== "object") {
        return;
    }
    if (!Array.isArray(value) && value.extensions && Object.keys(value.extensions).length > 0) {
        throw new Error(location + " contains unsupported glTF extensions");
    }
    Object.keys(value).forEach((key) => assertNoExtensions(value[key], location + "." + key));
}

function animationChannelAccessor(gltf, animation, nodeIndex, pathName) {
    const channel = (animation.channels || []).find((item) => {
        return item.target && item.target.node === nodeIndex && item.target.path === pathName;
    });
    assert(channel, animation.name + " " + pathName + " channel is missing");
    const sampler = animation.samplers && animation.samplers[channel.sampler];
    assert(sampler, animation.name + " " + pathName + " sampler is missing");
    const accessor = gltf.accessors && gltf.accessors[sampler.output];
    assert(accessor, animation.name + " " + pathName + " accessor is missing");
    return accessor;
}

function readFloatVectors(gltf, binary, accessor, componentCount) {
    assert(accessor.componentType === 5126, "animation vector must remain Float32");
    const view = gltf.bufferViews && gltf.bufferViews[accessor.bufferView];
    assert(view, "animation vector bufferView is missing");
    const packedSize = componentCount * 4;
    const stride = view.byteStride || packedSize;
    const start = (view.byteOffset || 0) + (accessor.byteOffset || 0);
    assert(stride >= packedSize, "animation vector stride is too small");
    const vectors = [];
    for (let sample = 0; sample < accessor.count; sample += 1) {
        const offset = start + sample * stride;
        const vector = [];
        for (let component = 0; component < componentCount; component += 1) {
            const value = binary.readFloatLE(offset + component * 4);
            assert(Number.isFinite(value), "animation vector contains a non-finite value");
            vector.push(value);
        }
        vectors.push(vector);
    }
    return vectors;
}

function nodeParentIndices(gltf) {
    const parents = new Array((gltf.nodes || []).length).fill(-1);
    (gltf.nodes || []).forEach((node, parentIndex) => {
        (node.children || []).forEach((childIndex) => {
            assert(parents[childIndex] === -1, "dancer node has multiple parents");
            parents[childIndex] = parentIndex;
        });
    });
    return parents;
}

function creatorFrameStats(description) {
    const output = { maximum: 0, total: 0 };
    function visit(value) {
        if (!value || typeof value !== "object") {
            return;
        }
        if (Number.isInteger(value.frameCount)) {
            output.maximum = Math.max(output.maximum, value.frameCount);
            output.total += value.frameCount;
        }
        Object.keys(value).forEach((key) => visit(value[key]));
    }
    visit(description);
    return output;
}

function collectJsonFiles(directory, output) {
    fs.readdirSync(directory, { withFileTypes: true }).forEach((entry) => {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            collectJsonFiles(entryPath, output);
        } else if (entry.isFile() && entry.name.endsWith(".json")) {
            output.push(entryPath);
        }
    });
}

function collectBuiltClipRecords(value, sourcePath, output) {
    if (Array.isArray(value)) {
        const name = value[1];
        if (typeof name === "string" && EXPECTED_ANIMATIONS[name]
            && value[2] === ".bin" && typeof value[3] === "number"
            && value[4] === 30 && value[6] && typeof value[6] === "object") {
            output.push({
                name,
                duration: value[3],
                description: value[6],
                sourcePath
            });
        }
        value.forEach((item) => collectBuiltClipRecords(item, sourcePath, output));
    } else if (value && typeof value === "object") {
        Object.keys(value).forEach((key) => {
            collectBuiltClipRecords(value[key], sourcePath, output);
        });
    }
}

function assertOptionalSourceInputs() {
    const presentNames = DANCER_SOURCE_NAMES.filter((name) => {
        return fs.existsSync(path.join(SOURCE_DIR, name + ".fbx"));
    });
    if (presentNames.length === 0) {
        console.log("dancer-source-inputs=absent provenance-only=ok");
        return;
    }
    assert(presentNames.length === DANCER_SOURCE_NAMES.length,
        "source-assets/dancer must contain either all seven audited FBXs or none");
    const hashes = {};
    presentNames.forEach((name) => {
        hashes[name] = sha256(fs.readFileSync(path.join(SOURCE_DIR, name + ".fbx")));
    });
    assertExpectedSourceHashes(hashes);
    console.log("dancer-source-inputs=ok files=7");
}

function assertCreatorBuildImport(dancerBuildDirectory) {
    const importDirectory = path.join(dancerBuildDirectory, "import");
    const nativeDirectory = path.join(dancerBuildDirectory, "native");
    assert(fs.statSync(importDirectory).isDirectory(), "built dancer import directory is missing");
    assert(fs.statSync(nativeDirectory).isDirectory(), "built dancer native directory is missing");
    const jsonFiles = [];
    collectJsonFiles(importDirectory, jsonFiles);
    const records = [];
    jsonFiles.forEach((jsonPath) => {
        collectBuiltClipRecords(JSON.parse(fs.readFileSync(jsonPath, "utf8")), jsonPath, records);
    });
    assert(records.length === Object.keys(EXPECTED_ANIMATIONS).length,
        "Creator build must serialize exactly seven dancer clips");
    assert(new Set(records.map((record) => record.name)).size === records.length,
        "Creator build contains duplicate dancer clip names");
    records.forEach((record) => {
        const expectedFrames = EXPECTED_CREATOR_IMPORT[record.name];
        assert(expectedFrames, "unexpected Creator clip: " + record.name);
        assert(Math.abs(record.duration - EXPECTED_ANIMATIONS[record.name]) <= 0.0001,
            record.name + " Creator build duration changed");
        const frames = creatorFrameStats(record.description);
        assert(frames.maximum === expectedFrames.maxFrameCount,
            record.name + " Creator build maximum frame count changed");
        assert(frames.total > frames.maximum,
            record.name + " Creator build animation description is incomplete");
        const uuid = path.basename(record.sourcePath, ".json");
        const nativePath = path.join(nativeDirectory, uuid.slice(0, 2), uuid + ".bin");
        assert(fs.statSync(nativePath).size > 0,
            record.name + " Creator native animation buffer is missing");
    });
    console.log(
        "creator-build-import=ok durations=1.041667,26.791666,12.458333,20.458334,18.791666,3.833333,1.041667"
            + " maxFrames=26,644,300,492,452,93,26"
    );
}

try {
    assertOptionalSourceInputs();
    const runtimeFiles = fs.readdirSync(RUNTIME_DIR)
        .filter((name) => !name.endsWith(".meta"))
        .sort();
    assert(
        JSON.stringify(runtimeFiles) === JSON.stringify(Object.keys(EXPECTED_FILES).sort()),
        "runtime directory must contain only the audited glTF and JPEG files"
    );

    Object.keys(EXPECTED_FILES).forEach((name) => {
        const expected = EXPECTED_FILES[name];
        const content = fs.readFileSync(path.join(RUNTIME_DIR, name));
        assert(content.length === expected.bytes, name + " byte length changed");
        assert(sha256(content) === expected.sha256, name + " SHA-256 changed");
    });
    const importFiles = fs.readdirSync(IMPORT_DIR)
        .filter((name) => !name.endsWith(".meta"))
        .sort();
    assert(
        JSON.stringify(importFiles) === JSON.stringify(["BullDancer.bin"]),
        "dancer import directory must contain only the audited external buffer"
    );

    const gltf = JSON.parse(fs.readFileSync(GLTF_PATH, "utf8"));
    const gltfMeta = JSON.parse(fs.readFileSync(GLTF_META_PATH, "utf8"));
    const binary = fs.readFileSync(BIN_PATH);
    const jpeg = fs.readFileSync(JPG_PATH);

    assert(gltf.asset && gltf.asset.version === "2.0", "BullDancer must be glTF 2.0");
    assert((gltf.extensionsUsed || []).length === 0, "extensionsUsed must remain empty");
    assert((gltf.extensionsRequired || []).length === 0, "extensionsRequired must remain empty");
    assertNoExtensions(gltf);

    assert(gltf.buffers && gltf.buffers.length === 1, "expected one glTF buffer");
    assert(
        binary.length === EXPECTED_IMPORT_BUFFER.bytes
            && sha256(binary) === EXPECTED_IMPORT_BUFFER.sha256,
        "BullDancer.bin import buffer changed"
    );
    assert(
        sha256(binary.subarray(0, EXPECTED_BASE_BUFFER_PREFIX.bytes))
            === EXPECTED_BASE_BUFFER_PREFIX.sha256,
        "original dancer binary prefix changed"
    );
    assert(
        gltf.buffers[0].uri === "../import/BullDancer.bin",
        "glTF must reference the audited import-only external buffer"
    );
    assert(
        gltf.buffers[0].byteLength === EXPECTED_IMPORT_BUFFER.bytes,
        "declared buffer length changed"
    );
    assert(binary.length === gltf.buffers[0].byteLength, "external buffer length does not match glTF");
    (gltf.bufferViews || []).forEach((view, index) => {
        const start = view.byteOffset || 0;
        const end = start + (view.byteLength || 0);
        assert(view.buffer === 0, "bufferView " + index + " points at an unexpected buffer");
        assert(start >= 0 && end <= binary.length, "bufferView " + index + " is out of range");
    });
    (gltf.accessors || []).forEach((accessor, index) => {
        if (typeof accessor.bufferView === "number") {
            assert(accessor.byteOffset === 0,
                "accessor " + index + " needs an explicit zero byteOffset for Creator 2.4.9");
        }
    });

    assert(gltf.meshes && gltf.meshes.length === 1, "expected one dancer mesh");
    assert(gltf.meshes[0].primitives.length === 1, "expected one dancer mesh primitive");
    const primitive = gltf.meshes[0].primitives[0];
    const position = gltf.accessors[primitive.attributes.POSITION];
    const weights = gltf.accessors[primitive.attributes.WEIGHTS_0];
    const indices = gltf.accessors[primitive.indices];
    assert(position.type === "VEC3" && position.count === 29568, "dancer position count changed");
    assert(weights.type === "VEC4" && weights.count === 29568, "dancer weight count changed");
    assert(weights.componentType === 5126 && !weights.normalized, "dancer weights must remain Float32");
    assert(indices.type === "SCALAR" && indices.count === 29568, "dancer index count changed");
    assert(indices.componentType === 5123, "dancer indices must remain Uint16");
    assert(indices.count / 3 === 9856, "dancer triangle count changed");

    const weightView = gltf.bufferViews[weights.bufferView];
    const weightOffset = (weightView.byteOffset || 0) + (weights.byteOffset || 0);
    const weightValues = new Float32Array(
        binary.buffer,
        binary.byteOffset + weightOffset,
        weights.count * 4
    );
    let maximumWeightSumError = 0;
    for (let vertex = 0; vertex < weights.count; vertex += 1) {
        let sum = 0;
        for (let component = 0; component < 4; component += 1) {
            const weight = weightValues[vertex * 4 + component];
            assert(Number.isFinite(weight) && weight >= 0 && weight <= 1, "dancer weight is out of range");
            sum += weight;
        }
        maximumWeightSumError = Math.max(maximumWeightSumError, Math.abs(sum - 1));
    }
    assert(maximumWeightSumError <= 0.00001, "dancer weights are not normalized per vertex");

    assert(gltf.skins && gltf.skins.length === 1, "expected one dancer skin");
    assert(gltf.skins[0].joints.length === 33, "dancer joint count changed");

    const animationNames = (gltf.animations || []).map((animation) => animation.name).sort();
    assert(
        JSON.stringify(animationNames) === JSON.stringify(Object.keys(EXPECTED_ANIMATIONS).sort()),
        "dancer animation names changed"
    );
    gltf.animations.forEach((animation) => {
        const actual = animationDuration(gltf, animation);
        const expected = EXPECTED_ANIMATIONS[animation.name];
        assert(Math.abs(actual - expected) <= 0.0001, animation.name + " duration changed");
    });

    const creatorClipMetas = Object.keys(gltfMeta.subMetas || {})
        .map((key) => gltfMeta.subMetas[key])
        .filter((meta) => meta.importer === "skeleton-animation-clip");
    assert(creatorClipMetas.length === Object.keys(EXPECTED_ANIMATIONS).length,
        "Creator meta must contain exactly seven dancer clips");
    assert(new Set(creatorClipMetas.map((meta) => meta.uuid)).size === creatorClipMetas.length,
        "Creator dancer clip UUIDs must remain unique");
    creatorClipMetas.forEach((meta) => {
        const animationName = meta.name.replace(/\.sac$/, "");
        const expectedFrames = EXPECTED_CREATOR_IMPORT[animationName];
        assert(expectedFrames, "Creator meta contains an unexpected clip: " + meta.name);
        assert(meta.modelUuid === gltfMeta.uuid, animationName + " Creator model UUID changed");
        assert(meta.animationID === gltf.animations.findIndex((item) => item.name === animationName),
            animationName + " Creator animation ID changed");
        assert(meta.animationFrameRate === 30,
            animationName + " Creator animation frame rate changed");
        assert(Math.abs(meta.duration - EXPECTED_ANIMATIONS[animationName]) <= 0.0001,
            animationName + " Creator meta duration changed");
        assert(meta.maxFrameCount === expectedFrames.maxFrameCount,
            animationName + " Creator maximum frame count changed");
        assert(meta.totalFrameCount === expectedFrames.totalFrameCount,
            animationName + " Creator total frame count changed");
    });

    const derivation = gltf.extras && gltf.extras.runtimeDerivation;
    assert(derivation, "runtime derivation metadata is missing");
    const modelDerivation = derivation.model;
    assertOriginalModelFacts({
        sourceName: modelDerivation && modelDerivation.sourceName,
        sourceFbxSha256: modelDerivation && modelDerivation.sourceFbxSha256,
        nodeCount: modelDerivation && modelDerivation.nodeCount,
        positionCount: modelDerivation && modelDerivation.positionCount,
        triangleCount: modelDerivation && modelDerivation.triangleCount,
        jointCount: modelDerivation && modelDerivation.jointCount
    });
    assert(modelDerivation.sourceRawGltfSha256
        === "7433c00ee6b4e9af0b55c64ad34de95f564b294073d5646ac2f4cc008325a99e",
    "base raw glTF provenance changed");
    assert(modelDerivation.sourceRawBinarySha256
        === "9e718c67b7cfb1472cece5ae382378f13a21bb07e9f5e4f5b49dbd3389f0d642",
    "base raw binary provenance changed");
    const weightNormalization = modelDerivation.weightNormalization;
    assert(weightNormalization
        && weightNormalization.operation === "divide each Float32 VEC4 by its per-vertex sum"
        && weightNormalization.vertexCount === ORIGINAL_DANCER_MODEL_FACTS.positionCount,
    "base weight normalization provenance changed");
    assert(weightNormalization.maximumInputSumError > 0.9,
        "source weight anomaly is no longer documented");
    assert(weightNormalization.maximumOutputSumError <= 0.0000001,
        "output weight normalization drifted");
    assert(weightNormalization.outputBaseBinarySha256 === EXPECTED_BASE_BUFFER_PREFIX.sha256,
        "normalized base binary provenance changed");

    assert(JSON.stringify(derivation.texture) === JSON.stringify({
        sourceName: ORIGINAL_DANCER_TEXTURE_FACTS.sourceName,
        sourceSha256: ORIGINAL_DANCER_TEXTURE_FACTS.sourceSha256,
        sourceWidth: ORIGINAL_DANCER_TEXTURE_FACTS.sourceWidth,
        sourceHeight: ORIGINAL_DANCER_TEXTURE_FACTS.sourceHeight,
        sourceHasAlpha: ORIGINAL_DANCER_TEXTURE_FACTS.sourceHasAlpha,
        runtimeName: ORIGINAL_DANCER_TEXTURE_FACTS.runtimeName,
        runtimeSha256: ORIGINAL_DANCER_TEXTURE_FACTS.runtimeSha256,
        runtimeWidth: ORIGINAL_DANCER_TEXTURE_FACTS.runtimeWidth,
        runtimeHeight: ORIGINAL_DANCER_TEXTURE_FACTS.runtimeHeight,
        runtimeBytes: ORIGINAL_DANCER_TEXTURE_FACTS.runtimeBytes,
        jpegQuality: ORIGINAL_DANCER_TEXTURE_FACTS.jpegQuality
    }), "original dancer texture provenance changed");
    const menuIdleAnimation = gltf.animations.find((animation) => animation.name === "IdleSway");
    const gameplayIdleAnimation = gltf.animations.find((animation) => animation.name === "IdleSway0");
    const menuIdleAccessors = menuIdleAnimation.samplers.map((sampler) => {
        return [sampler.input, sampler.output];
    });
    const gameplayIdleAccessors = gameplayIdleAnimation.samplers.map((sampler) => {
        return [sampler.input, sampler.output];
    });
    const idleAccessorsShared = JSON.stringify(menuIdleAccessors)
        === JSON.stringify(gameplayIdleAccessors);
    assertIdleAliasPolicy({
        ...derivation.clipSources,
        rawIdleMatchesDanceCombo: derivation.rawIdleInspection
            && derivation.rawIdleInspection.matchesDanceCombo,
        outputIdleSharesAccessors: idleAccessorsShared
    });
    assert(JSON.stringify(derivation.clipSources) === JSON.stringify(DANCER_CLIP_SOURCES),
        "runtime clip/source mapping changed");
    assert(derivation.rawIdleInspection.excludedFromRuntime === true
        && derivation.rawIdleInspection.sourceFbxSha256 === EXPECTED_DANCER_FBX_SHA256.IdleSway,
    "misleading raw IdleSway exclusion changed");
    assert(
        derivation.hipsTranslationBaseline === "IdleSway0",
        "Hips translation baseline marker changed"
    );
    assert(
        JSON.stringify(derivation.alignedAnimations)
            === JSON.stringify([
                "DanceCombo",
                "DanceCombo2",
                "ResultPose",
                "ResultPose2",
                "ResultPose3"
            ]),
        "Hips-aligned animation marker changed"
    );
    assert(
        derivation.operation === "per-clip constant translation offset",
        "Hips translation derivation operation changed"
    );
    const hipsNodeIndex = (gltf.nodes || []).findIndex((node) => node.name === "Hips");
    assert(hipsNodeIndex >= 0, "Hips node is missing");
    const hipsTranslations = {};
    gltf.animations.forEach((animation) => {
        const accessor = animationChannelAccessor(
            gltf,
            animation,
            hipsNodeIndex,
            "translation"
        );
        assert(accessor.type === "VEC3", animation.name + " Hips translation must remain VEC3");
        hipsTranslations[animation.name] = readFloatVectors(gltf, binary, accessor, 3);
    });
    const idleFirst = hipsTranslations.IdleSway[0];
    Object.keys(EXPECTED_HIPS_RELATIVE_MOTION).forEach((animationName) => {
        const translations = hipsTranslations[animationName];
        translations[0].forEach((value, component) => {
            assert(
                Math.abs(value - idleFirst[component]) <= 0.000001,
                animationName + " Hips baseline does not match IdleSway"
            );
        });
        const last = translations[translations.length - 1];
        const expectedRelativeMotion = EXPECTED_HIPS_RELATIVE_MOTION[animationName];
        last.forEach((value, component) => {
            const actualRelativeMotion = value - translations[0][component];
            assert(
                Math.abs(actualRelativeMotion - expectedRelativeMotion[component]) <= 0.000001,
                animationName + " Hips relative motion changed"
            );
        });
    });

    const retarget = derivation.retarget;
    assert(retarget, "retarget derivation metadata is missing");
    assert(
        retarget.mapping === "unique bone name with identical parent name",
        "retarget mapping rule changed"
    );
    assert(retarget.restSpace === "node-local TRS", "retarget rest-space marker changed");
    assert(
        retarget.formula
            === "targetRestLocal * inverse(sourceRestLocal) * sourceAnimatedLocal",
        "retarget correction formula changed"
    );
    assert(retarget.targetSkinJointCount === 33, "retarget target joint count changed");
    assert(
        retarget.sourceConversion
            === "FBX2glTF 2.0 (Cocos Creator 2.4.9 bundled binary; no gltfpack or mesh decimation)",
        "retarget source conversion recipe changed"
    );
    assert(
        retarget.baseBinaryPrefixBytes === EXPECTED_BASE_BUFFER_PREFIX.bytes
            && retarget.baseBinaryPrefixSha256 === EXPECTED_BASE_BUFFER_PREFIX.sha256,
        "retarget base binary provenance changed"
    );
    assert(
        retarget.maximumRestRecoveryError <= 1e-9,
        "retarget rest-space recovery error is too large"
    );
    assert(retarget.maximumTrsResidual <= 0.0001, "retarget TRS residual is too large");
    assert(
        retarget.maximumQuaternionNormError <= 1e-12,
        "retarget quaternion normalization error is too large"
    );

    const parents = nodeParentIndices(gltf);
    const mappings = retarget.mappings || [];
    assert(mappings.length === 32, "retarget mapped bone count changed");
    assert(new Set(mappings.map((mapping) => mapping.bone)).size === 32,
        "retarget mappings must use unique bone names");
    let mappedIndexMismatchCount = 0;
    mappings.forEach((mapping) => {
        const targetNode = gltf.nodes[mapping.targetNode];
        assert(targetNode && targetNode.name === mapping.bone,
            "retarget target node/name mapping changed for " + mapping.bone);
        const targetParentIndex = parents[mapping.targetNode];
        const targetParentName = targetParentIndex >= 0 ? gltf.nodes[targetParentIndex].name : null;
        assert(targetParentName === mapping.parent,
            "retarget target parent mapping changed for " + mapping.bone);
        if (mapping.sourceNode !== mapping.targetNode) {
            mappedIndexMismatchCount += 1;
        }
    });
    assert(mappedIndexMismatchCount === 0,
        "same-rig source node indices unexpectedly changed");

    const mappingNames = new Set(mappings.map((mapping) => mapping.bone));
    Object.keys(EXPECTED_RETARGET_ANIMATIONS).forEach((animationName) => {
        const expected = EXPECTED_RETARGET_ANIMATIONS[animationName];
        const summary = retarget.animations && retarget.animations[animationName];
        const animation = gltf.animations.find((item) => item.name === animationName);
        assert(summary && animation, animationName + " retarget summary is missing");
        assert(summary.sourceNodeCount === 39, animationName + " source node count changed");
        assert(summary.sourceSkinJointCount === 33, animationName + " source joint count changed");
        assert(summary.channelCount === expected.channelCount,
            animationName + " source channel count changed");
        assert(summary.sourceIndexMismatchCount === 0,
            animationName + " source/target node indices unexpectedly changed");
        assert(summary.restMismatchChannelCount === expected.channelCount,
            animationName + " no longer proves rest-space correction is required");
        assert(summary.maximumSourceTargetRestDelta > 1,
            animationName + " source/target rest delta is unexpectedly absent");
        assert(Math.abs(summary.duration - EXPECTED_ANIMATIONS[animationName]) <= 0.0001,
            animationName + " retarget duration metadata changed");
        assert(summary.sourceRawGltfSha256 === expected.sourceRawGltfSha256,
            animationName + " direct-conversion glTF hash changed");
        assert(summary.sourceRawBinarySha256 === expected.sourceRawBinarySha256,
            animationName + " direct-conversion buffer hash changed");
        assert(summary.sourceFbxSha256 === EXPECTED_DANCER_FBX_SHA256[animationName],
            animationName + " FBX source hash changed");
        assert(summary.sourceTextureSha256 === ORIGINAL_DANCER_TEXTURE_FACTS.sourceSha256,
            animationName + " source texture hash changed");
        assert(animation.channels.length === expected.channelCount,
            animationName + " output channel count changed");
        animation.channels.forEach((channel) => {
            const targetNode = gltf.nodes[channel.target.node];
            assert(targetNode && mappingNames.has(targetNode.name),
                animationName + " channel targets an unaudited bone");
            const sampler = animation.samplers[channel.sampler];
            const input = gltf.accessors[sampler.input];
            const output = gltf.accessors[sampler.output];
            assert(input && input.componentType === 5126 && input.type === "SCALAR",
                animationName + " time input must remain Float32");
            assert(input.byteOffset === 0,
                animationName + " time input needs an explicit zero byteOffset for Creator 2.4.9");
            assert(output && output.componentType === 5126 && !output.normalized,
                animationName + " output must remain non-normalized Float32");
            assert(output.byteOffset === 0,
                animationName + " output needs an explicit zero byteOffset for Creator 2.4.9");
        });
    });

    const rotationAccessors = new Set();
    gltf.animations.forEach((animation) => {
        (animation.channels || []).forEach((channel) => {
            if (channel.target && channel.target.path === "rotation") {
                const sampler = animation.samplers[channel.sampler];
                assert(sampler, animation.name + " rotation sampler is missing");
                rotationAccessors.add(sampler.output);
            }
        });
    });
    assert(rotationAccessors.size === 172, "dancer rotation accessor count changed");
    let quaternionCount = 0;
    let minimumQuaternionNorm = Number.POSITIVE_INFINITY;
    let maximumQuaternionNorm = Number.NEGATIVE_INFINITY;
    rotationAccessors.forEach((accessorIndex) => {
        const accessor = gltf.accessors[accessorIndex];
        assert(
            accessor && accessor.type === "VEC4" && accessor.componentType === 5126
                && !accessor.normalized,
            "animation rotations must remain non-normalized Float32 quaternions"
        );
        const view = gltf.bufferViews[accessor.bufferView];
        const stride = view.byteStride || 16;
        const start = (view.byteOffset || 0) + (accessor.byteOffset || 0);
        assert(stride >= 16, "animation quaternion stride is too small");
        for (let valueIndex = 0; valueIndex < accessor.count; valueIndex += 1) {
            const offset = start + valueIndex * stride;
            let normSquared = 0;
            for (let component = 0; component < 4; component += 1) {
                const value = binary.readFloatLE(offset + component * 4);
                assert(Number.isFinite(value), "animation quaternion contains a non-finite value");
                normSquared += value * value;
            }
            const norm = Math.sqrt(normSquared);
            minimumQuaternionNorm = Math.min(minimumQuaternionNorm, norm);
            maximumQuaternionNorm = Math.max(maximumQuaternionNorm, norm);
        }
        quaternionCount += accessor.count;
    });
    assert(quaternionCount === 57394, "dancer quaternion sample count changed");
    assert(
        minimumQuaternionNorm >= 0.99999 && maximumQuaternionNorm <= 1.00001,
        "animation quaternions are not unit length"
    );

    assert(gltf.images && gltf.images.length === 1, "expected one dancer texture reference");
    assert(gltf.images[0].uri === ORIGINAL_DANCER_TEXTURE_FACTS.runtimeName,
        "dancer texture URI changed");
    const runtimeUris = []
        .concat((gltf.buffers || []).map((item) => item.uri))
        .concat((gltf.images || []).map((item) => item.uri))
        .filter((item) => typeof item === "string");
    assert(
        runtimeUris.every((uri) => !/[.]fbx(?:$|[/?#])|[.]fbm(?:$|[/?#])|Image_0[.]png/i.test(uri)),
        "runtime glTF must not reference raw FBX/FBM source material"
    );
    assert(jpeg[0] === 0xff && jpeg[1] === 0xd8,
        "OriginalDancerAlbedo.jpg is missing JPEG SOI magic");
    assert(
        jpeg[jpeg.length - 2] === 0xff && jpeg[jpeg.length - 1] === 0xd9,
        "OriginalDancerAlbedo.jpg is missing JPEG EOI magic"
    );

    console.log(
        "dancer-assets=ok positions=29568 triangles=9856 weights=Float32/normalized joints=33"
            + " quaternions=Float32/57394 hips=IdleSway0-aligned"
            + " model=IdleSway0-fbx retarget=name+parent/rest-local mappings=32"
            + " animations=IdleSway,DanceCombo,ResultPose,DanceCombo2,ResultPose2,ResultPose3,IdleSway0"
    );
    if (process.argv[2]) {
        assertCreatorBuildImport(path.resolve(process.argv[2]));
    }
} catch (error) {
    console.error("error: dancer asset verification failed: " + error.message);
    process.exitCode = 1;
}
