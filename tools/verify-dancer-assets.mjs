import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, "..");
const RUNTIME_DIR = path.join(PROJECT_ROOT, "assets", "spine", "runtime");
const IMPORT_DIR = path.join(PROJECT_ROOT, "assets", "spine", "import");
const GLTF_PATH = path.join(RUNTIME_DIR, "BullDancer.gltf");
const BIN_PATH = path.join(IMPORT_DIR, "BullDancer.bin");
const JPG_PATH = path.join(RUNTIME_DIR, "BullAlbedo.jpg");

const EXPECTED_FILES = {
    "BullDancer.gltf": {
        bytes: 39098,
        sha256: "9ab6c2de2d69eb80f73d402d67f33a3803637e54d2060293c1426d274c70a2dd"
    },
    "BullAlbedo.jpg": {
        bytes: 377616,
        sha256: "1c825c70adc1469de65f453c494f3749fee22686c8bdd08c8baa1028fcf41030"
    }
};

const EXPECTED_IMPORT_BUFFER = {
    bytes: 3406860,
    sha256: "0ae9d0faba3c3df5a0333880cf82f2a96d7669d082de5a8c38663963d773d7de"
};

const EXPECTED_ANIMATIONS = {
    IdleSway: 1.06666672,
    DanceCombo: 26.8000011,
    ResultPose: 18.8000011
};

const EXPECTED_HIPS_RELATIVE_MOTION = {
    DanceCombo: [-0.0352457481, 0.0370691419, -0.0000000093],
    ResultPose: [0.4665272665, -0.0310076475, 0]
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
        gltf.buffers[0].uri === "../import/BullDancer.bin",
        "glTF must reference the audited import-only external buffer"
    );
    assert(gltf.buffers[0].byteLength === 3406860, "declared buffer length changed");
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

    const derivation = gltf.extras && gltf.extras.runtimeDerivation;
    assert(derivation, "runtime derivation metadata is missing");
    assert(
        derivation.hipsTranslationBaseline === "IdleSway",
        "Hips translation baseline marker changed"
    );
    assert(
        JSON.stringify(derivation.alignedAnimations) === JSON.stringify(["DanceCombo", "ResultPose"]),
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
    ["DanceCombo", "ResultPose"].forEach((animationName) => {
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
    assert(rotationAccessors.size === 136, "dancer rotation accessor count changed");
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
    assert(quaternionCount === 29032, "dancer quaternion sample count changed");
    assert(
        minimumQuaternionNorm >= 0.99999 && maximumQuaternionNorm <= 1.00001,
        "animation quaternions are not unit length"
    );

    assert(gltf.images && gltf.images.length === 1, "expected one dancer texture reference");
    assert(gltf.images[0].uri === "BullAlbedo.jpg", "dancer texture URI changed");
    assert(jpeg[0] === 0xff && jpeg[1] === 0xd8, "BullAlbedo.jpg is missing JPEG SOI magic");
    assert(
        jpeg[jpeg.length - 2] === 0xff && jpeg[jpeg.length - 1] === 0xd9,
        "BullAlbedo.jpg is missing JPEG EOI magic"
    );

    console.log(
        "dancer-assets=ok vertices=44995 indices=288315 weights=Float32 joints=54"
            + " quaternions=Float32/29032 hips=IdleSway-aligned"
            + " animations=IdleSway,DanceCombo,ResultPose"
    );
} catch (error) {
    console.error("error: dancer asset verification failed: " + error.message);
    process.exitCode = 1;
}
