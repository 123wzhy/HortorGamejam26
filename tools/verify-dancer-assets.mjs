import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, "..");
const RUNTIME_DIR = path.join(PROJECT_ROOT, "assets", "spine", "runtime");
const IMPORT_DIR = path.join(PROJECT_ROOT, "assets", "spine", "import");
const GLTF_PATH = path.join(RUNTIME_DIR, "BullDancer.gltf");
const GLTF_META_PATH = GLTF_PATH + ".meta";
const BIN_PATH = path.join(IMPORT_DIR, "BullDancer.bin");
const JPG_PATH = path.join(RUNTIME_DIR, "BullAlbedo.jpg");

const EXPECTED_FILES = {
    "BullDancer.gltf": {
        bytes: 74213,
        sha256: "ab4b402e58b3d3ed8999f267b06c833a8b5391d37548487ad89e25f39e5085f5"
    },
    "BullAlbedo.jpg": {
        bytes: 377616,
        sha256: "1c825c70adc1469de65f453c494f3749fee22686c8bdd08c8baa1028fcf41030"
    }
};

const EXPECTED_IMPORT_BUFFER = {
    bytes: 3859152,
    sha256: "8c52122dd0d8ea2e4785e3c3ad42ec57460e415164758675da73c031b6097b66"
};

const EXPECTED_BASE_BUFFER_PREFIX = {
    bytes: 3406860,
    sha256: "0ae9d0faba3c3df5a0333880cf82f2a96d7669d082de5a8c38663963d773d7de"
};

const EXPECTED_ANIMATIONS = {
    IdleSway: 1.06666672,
    DanceCombo: 26.8000011,
    ResultPose: 18.8000011,
    DanceCombo2: 20.46666717529297,
    ResultPose2: 18.80000114440918,
    ResultPose3: 3.8333334922790527,
    IdleSway0: 1.0666667222976685
};

const EXPECTED_HIPS_RELATIVE_MOTION = {
    DanceCombo: [-0.0352457481, 0.0370691419, -0.0000000093],
    DanceCombo2: [0.2390609962, 0.0426396132, -0.0222857976],
    ResultPose: [0.4665272665, -0.0310076475, 0],
    ResultPose2: [0.6390499306, 0.0767080784, -0.2742886087],
    ResultPose3: [-0.6838156151, 0.0282412171, 1.1868078867],
    IdleSway0: [-0.0025533129, -0.0106902719, 0.0052320659]
};

const EXPECTED_RETARGET_ANIMATIONS = {
    DanceCombo2: {
        channelCount: 25,
        sourceIndexMismatchCount: 13,
        sourceOptimizedGltfSha256:
            "ff4734a6027ddd2698150519cb2f8a55c5cb735119e9027f90c51ed08e478b3d",
        sourceFbxSha256:
            "196aa9da46163f84a8ff1745352f01a2f317304964aadf422605ec2662fc6eab"
    },
    ResultPose2: {
        channelCount: 36,
        sourceIndexMismatchCount: 19,
        sourceOptimizedGltfSha256:
            "6a5968f1cbbf967f4e18cd4049fb216d37b6acf0408e4ea835d268b2b1d7e941",
        sourceFbxSha256:
            "10f33f1c5b70771be6aaa22c9235d765fec40eda11a4b00659c44f1eb3627e19"
    },
    ResultPose3: {
        channelCount: 29,
        sourceIndexMismatchCount: 18,
        sourceOptimizedGltfSha256:
            "7cff15516a3d4fa739cfe0712acc668ab412c23e049bbbc004081bbefddf32dc",
        sourceFbxSha256:
            "94c047d02400ea73e9318d2cdf8562aebbc773182dc89072ae3ad39e5ac38413"
    },
    IdleSway0: {
        channelCount: 34,
        sourceIndexMismatchCount: 18,
        sourceOptimizedGltfSha256:
            "922b424ba65968d00ea2de13c1d45a587bdb26f5334f35d0034c510d41ecb19c",
        sourceFbxSha256:
            "c0fc77ec2595efb4db4ab949729a1b4e72536fa143311d759b9febc596909f33"
    }
};

const EXPECTED_CREATOR_IMPORT = {
    IdleSway: { maxFrameCount: 33, totalFrameCount: 1376 },
    DanceCombo: { maxFrameCount: 805, totalFrameCount: 16827 },
    ResultPose: { maxFrameCount: 565, totalFrameCount: 11879 },
    DanceCombo2: { maxFrameCount: 615, totalFrameCount: 12914 },
    ResultPose2: { maxFrameCount: 565, totalFrameCount: 11868 },
    ResultPose3: { maxFrameCount: 116, totalFrameCount: 2433 },
    IdleSway0: { maxFrameCount: 33, totalFrameCount: 945 }
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
        "creator-build-import=ok durations=1.066667,26.800001,18.800001,20.466667,18.800001,3.833333,1.066667"
            + " maxFrames=33,805,565,615,565,116,33"
    );
}

try {
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

    assert(gltf.meshes && gltf.meshes.length === 1, "expected one dancer mesh");
    assert(gltf.meshes[0].primitives.length === 1, "expected one dancer mesh primitive");
    const primitive = gltf.meshes[0].primitives[0];
    const position = gltf.accessors[primitive.attributes.POSITION];
    const weights = gltf.accessors[primitive.attributes.WEIGHTS_0];
    const indices = gltf.accessors[primitive.indices];
    assert(position.type === "VEC3" && position.count === 44995, "dancer vertex count changed");
    assert(weights.type === "VEC4" && weights.count === 44995, "dancer weight count changed");
    assert(weights.componentType === 5126 && !weights.normalized, "dancer weights must remain Float32");
    assert(indices.type === "SCALAR" && indices.count === 288315, "dancer index count changed");
    assert(indices.componentType === 5123, "dancer indices must remain Uint16");
    assert(indices.count / 3 === 96105, "dancer triangle count changed");

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
    assert(gltf.skins[0].joints.length === 54, "dancer joint count changed");

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
    assert(
        derivation.hipsTranslationBaseline === "IdleSway",
        "Hips translation baseline marker changed"
    );
    assert(
        JSON.stringify(derivation.alignedAnimations)
            === JSON.stringify([
                "DanceCombo",
                "DanceCombo2",
                "IdleSway0",
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
    assert(retarget.targetSkinJointCount === 54, "retarget target joint count changed");
    assert(
        retarget.sourceConversion
            === "FBX2glTF 2.0 then gltfpack 1.2 -si 0.2 -sa -noq -kn -ac (30 Hz default)",
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
    assert(mappedIndexMismatchCount > 0,
        "retarget metadata no longer proves that node-index copying is invalid");

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
        assert(summary.sourceIndexMismatchCount === expected.sourceIndexMismatchCount,
            animationName + " source/target node mismatch count changed");
        assert(Math.abs(summary.duration - EXPECTED_ANIMATIONS[animationName]) <= 0.0001,
            animationName + " retarget duration metadata changed");
        assert(summary.sourceOptimizedGltfSha256 === expected.sourceOptimizedGltfSha256,
            animationName + " optimized source hash changed");
        assert(summary.sourceFbxSha256 === expected.sourceFbxSha256,
            animationName + " FBX source hash changed");
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
    assert(rotationAccessors.size === 249, "dancer rotation accessor count changed");
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
    assert(quaternionCount === 55965, "dancer quaternion sample count changed");
    assert(
        minimumQuaternionNorm >= 0.99999 && maximumQuaternionNorm <= 1.00001,
        "animation quaternions are not unit length"
    );

    assert(gltf.images && gltf.images.length === 1, "expected one dancer texture reference");
    assert(gltf.images[0].uri === "BullAlbedo.jpg", "dancer texture URI changed");
    const runtimeUris = []
        .concat((gltf.buffers || []).map((item) => item.uri))
        .concat((gltf.images || []).map((item) => item.uri))
        .filter((item) => typeof item === "string");
    assert(
        runtimeUris.every((uri) => !/[.]fbx(?:$|[/?#])|[.]fbm(?:$|[/?#])|Image_0[.]png/i.test(uri)),
        "runtime glTF must not reference raw FBX/FBM source material"
    );
    assert(jpeg[0] === 0xff && jpeg[1] === 0xd8, "BullAlbedo.jpg is missing JPEG SOI magic");
    assert(
        jpeg[jpeg.length - 2] === 0xff && jpeg[jpeg.length - 1] === 0xd9,
        "BullAlbedo.jpg is missing JPEG EOI magic"
    );

    console.log(
        "dancer-assets=ok vertices=44995 indices=288315 weights=Float32 joints=54"
            + " quaternions=Float32/55965 hips=IdleSway-aligned"
            + " retarget=name+parent/rest-local mappings=32"
            + " animations=IdleSway,DanceCombo,ResultPose,DanceCombo2,ResultPose2,ResultPose3,IdleSway0"
    );
    if (process.argv[2]) {
        assertCreatorBuildImport(path.resolve(process.argv[2]));
    }
} catch (error) {
    console.error("error: dancer asset verification failed: " + error.message);
    process.exitCode = 1;
}
