import crypto from "crypto";
import fs from "fs";
import path from "path";
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

const COMPONENTS = {
    SCALAR: 1,
    VEC2: 2,
    VEC3: 3,
    VEC4: 4,
    MAT4: 16
};

const COMPONENT_INFO = {
    5120: { bytes: 1, read: "readInt8" },
    5121: { bytes: 1, read: "readUInt8" },
    5122: { bytes: 2, read: "readInt16LE" },
    5123: { bytes: 2, read: "readUInt16LE" },
    5125: { bytes: 4, read: "readUInt32LE" },
    5126: { bytes: 4, read: "readFloatLE" }
};

const EXPECTED_RAW_CONVERSION = {
    DanceCombo: {
        gltfSha256: "17b8ff13767ec54124af373172a021ac55692465d281fafe380b4d668bb42ade",
        binarySha256: "a09ff50aea935c4ca343c9f8f7b00dd329b835960cdd04e2db0807c95a879815"
    },
    DanceCombo2: {
        gltfSha256: "d22cce7fe39050af4d4bceb6811feec9b4b86d893c5ab7a7e572508a96b86948",
        binarySha256: "4e8d15d32aa166defa471ff83c13717f131e112acd4b3349e3648740d5c70725"
    },
    IdleSway: {
        gltfSha256: "17b8ff13767ec54124af373172a021ac55692465d281fafe380b4d668bb42ade",
        binarySha256: "a09ff50aea935c4ca343c9f8f7b00dd329b835960cdd04e2db0807c95a879815"
    },
    IdleSway0: {
        gltfSha256: "7433c00ee6b4e9af0b55c64ad34de95f564b294073d5646ac2f4cc008325a99e",
        binarySha256: "9e718c67b7cfb1472cece5ae382378f13a21bb07e9f5e4f5b49dbd3389f0d642"
    },
    ResultPose: {
        gltfSha256: "eb36ef9882d130558012da7c6a65ef583125001b31a478c4322b7400638b4d85",
        binarySha256: "2ea7db8c4f021de5b17c01b9edb428b35339815c1738b2484d32f95d6f7e3598"
    },
    ResultPose2: {
        gltfSha256: "6225a7d23005345245d8be3a593f75626dadbcb67af1d30887373f337bfaf923",
        binarySha256: "68f04c58fd88fa40a44f12c418a121c97faf4e312a45d0d1d99819529b1f1af2"
    },
    ResultPose3: {
        gltfSha256: "b2e92fd1b22fedc6f8c2e7d5c4f4a8c99ed2ce55321afc65a16331c59552638c",
        binarySha256: "d3ff13e71dac16ad267d00609536bc817c340413402e9002a687ed15a1c6dbf4"
    }
};

function fail(message) {
    throw new Error(message);
}

function assert(condition, message) {
    if (!condition) {
        fail(message);
    }
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function align4(value) {
    return (value + 3) & ~3;
}

function sha256(buffer) {
    return crypto.createHash("sha256").update(buffer).digest("hex");
}

function pngFacts(buffer) {
    const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    assert(buffer.length >= 26 && buffer.subarray(0, 8).equals(signature),
        "source texture is not a PNG");
    assert(buffer.toString("ascii", 12, 16) === "IHDR", "source texture IHDR is missing");
    const colorType = buffer[25];
    return {
        width: buffer.readUInt32BE(16),
        height: buffer.readUInt32BE(20),
        hasAlpha: colorType === 4 || colorType === 6
    };
}

function accessorFingerprint(document, binary, accessorIndex) {
    return sha256(Buffer.from(JSON.stringify(readAccessor(document, binary, accessorIndex))));
}

function hierarchyFingerprint(document) {
    const parents = parentIndices(document);
    return sha256(Buffer.from(JSON.stringify(document.nodes.map((node, index) => {
        const parent = parents[index];
        return [node.name || null, parent >= 0 ? document.nodes[parent].name || null : null];
    }))));
}

function meshFacts(document) {
    assert(document.meshes && document.meshes.length === 1, "source must contain one mesh");
    assert(document.meshes[0].primitives && document.meshes[0].primitives.length === 1,
        "source must contain one mesh primitive");
    const primitive = document.meshes[0].primitives[0];
    const position = document.accessors[primitive.attributes.POSITION];
    const weights = document.accessors[primitive.attributes.WEIGHTS_0];
    const indices = document.accessors[primitive.indices];
    assert(position && weights && indices, "source mesh accessors are incomplete");
    assert(indices.count % 3 === 0, "source mesh index count is not triangular");
    return {
        nodeCount: document.nodes.length,
        positionCount: position.count,
        triangleCount: indices.count / 3,
        jointCount: document.skins[0].joints.length,
        positionAccessor: primitive.attributes.POSITION,
        texcoordAccessor: primitive.attributes.TEXCOORD_0,
        jointsAccessor: primitive.attributes.JOINTS_0,
        weightsAccessor: primitive.attributes.WEIGHTS_0,
        indicesAccessor: primitive.indices
    };
}

function normalizeSkinWeights(document, sourceBinary, weightsAccessorIndex) {
    const accessor = document.accessors[weightsAccessorIndex];
    assert(accessor.componentType === 5126 && accessor.type === "VEC4" && !accessor.normalized,
        "base skin weights must be non-normalized Float32 VEC4");
    const view = document.bufferViews[accessor.bufferView];
    const stride = view.byteStride || 16;
    const start = (view.byteOffset || 0) + (accessor.byteOffset || 0);
    assert(stride >= 16, "base skin weight stride is too small");
    const binary = Buffer.from(sourceBinary);
    let maximumInputSumError = 0;
    let maximumOutputSumError = 0;
    for (let vertex = 0; vertex < accessor.count; vertex += 1) {
        const offset = start + vertex * stride;
        const values = [];
        let sum = 0;
        for (let component = 0; component < 4; component += 1) {
            const value = sourceBinary.readFloatLE(offset + component * 4);
            assert(Number.isFinite(value) && value >= 0,
                "base skin weight is negative or non-finite");
            values.push(value);
            sum += value;
        }
        assert(sum > 0, "base skin vertex has zero total weight");
        maximumInputSumError = Math.max(maximumInputSumError, Math.abs(sum - 1));
        let outputSum = 0;
        values.forEach((value, component) => {
            const normalized = value / sum;
            binary.writeFloatLE(normalized, offset + component * 4);
            outputSum += binary.readFloatLE(offset + component * 4);
        });
        maximumOutputSumError = Math.max(maximumOutputSumError, Math.abs(outputSum - 1));
    }
    assert(maximumInputSumError > 0.9,
        "source weight anomaly disappeared; review whether normalization is still required");
    assert(maximumOutputSumError <= 0.0000001,
        "normalized skin weights do not sum to one");
    return {
        binary,
        vertexCount: accessor.count,
        maximumInputSumError,
        maximumOutputSumError,
        outputSha256: sha256(binary)
    };
}

function animationAccessors(animation) {
    const accessors = [];
    animation.samplers.forEach((sampler) => {
        accessors.push(sampler.input, sampler.output);
    });
    return accessors;
}

function decodeNormalized(value, componentType, normalized) {
    if (!normalized) {
        return value;
    }
    switch (componentType) {
        case 5120:
            return Math.max(value / 127, -1);
        case 5121:
            return value / 255;
        case 5122:
            return Math.max(value / 32767, -1);
        case 5123:
            return value / 65535;
        case 5125:
            return value / 4294967295;
        default:
            return value;
    }
}

function readAccessor(document, binary, accessorIndex) {
    const accessor = document.accessors && document.accessors[accessorIndex];
    assert(accessor, "accessor is missing: " + accessorIndex);
    assert(typeof accessor.bufferView === "number", "sparse accessors are unsupported");
    const view = document.bufferViews && document.bufferViews[accessor.bufferView];
    assert(view && view.buffer === 0, "accessor must use the single source buffer");
    const componentCount = COMPONENTS[accessor.type];
    const component = COMPONENT_INFO[accessor.componentType];
    assert(componentCount && component, "unsupported accessor type");
    const packedBytes = componentCount * component.bytes;
    const stride = view.byteStride || packedBytes;
    assert(stride >= packedBytes, "accessor byte stride is too small");
    const start = (view.byteOffset || 0) + (accessor.byteOffset || 0);
    const values = [];
    for (let item = 0; item < accessor.count; item += 1) {
        const vector = [];
        for (let part = 0; part < componentCount; part += 1) {
            const offset = start + item * stride + part * component.bytes;
            assert(offset + component.bytes <= binary.length, "accessor is out of range");
            const raw = binary[component.read](offset);
            const value = decodeNormalized(raw, accessor.componentType, accessor.normalized);
            assert(Number.isFinite(value), "accessor contains a non-finite value");
            vector.push(value);
        }
        values.push(vector);
    }
    return values;
}

function vectorLength(value) {
    return Math.sqrt(value.reduce((sum, part) => sum + part * part, 0));
}

function normalizeQuaternion(value) {
    const length = vectorLength(value);
    assert(length > 0 && Number.isFinite(length), "quaternion has zero or non-finite length");
    return value.map((part) => part / length);
}

function quaternionDot(left, right) {
    return left.reduce((sum, value, index) => sum + value * right[index], 0);
}

function slerpQuaternion(leftValue, rightValue, amount) {
    const left = normalizeQuaternion(leftValue);
    let right = normalizeQuaternion(rightValue);
    let dot = quaternionDot(left, right);
    if (dot < 0) {
        right = right.map((value) => -value);
        dot = -dot;
    }
    if (dot > 0.9995) {
        return normalizeQuaternion(left.map((value, index) => {
            return value + (right[index] - value) * amount;
        }));
    }
    const theta = Math.acos(Math.max(-1, Math.min(1, dot)));
    const sinTheta = Math.sin(theta);
    const leftWeight = Math.sin((1 - amount) * theta) / sinTheta;
    const rightWeight = Math.sin(amount * theta) / sinTheta;
    return left.map((value, index) => value * leftWeight + right[index] * rightWeight);
}

function lerpVector(left, right, amount) {
    return left.map((value, index) => value + (right[index] - value) * amount);
}

function sampleTrack(track, timeMs) {
    const times = track.times;
    const values = track.values;
    assert(times.length === values.length && times.length > 0, "animation track is empty");
    if (times.length === 1 || timeMs <= times[0]) {
        return values[0].slice();
    }
    if (timeMs >= times[times.length - 1]) {
        return values[values.length - 1].slice();
    }
    let low = 0;
    let high = times.length - 1;
    while (high - low > 1) {
        const middle = Math.floor((low + high) / 2);
        if (times[middle] <= timeMs) {
            low = middle;
        } else {
            high = middle;
        }
    }
    if (track.interpolation === "STEP") {
        return values[low].slice();
    }
    assert(track.interpolation === "LINEAR", "unsupported interpolation: " + track.interpolation);
    const span = times[high] - times[low];
    const amount = span > 0 ? (timeMs - times[low]) / span : 0;
    return track.pathName === "rotation"
        ? slerpQuaternion(values[low], values[high], amount)
        : lerpVector(values[low], values[high], amount);
}

function nodeTrs(node) {
    assert(!node.matrix, "matrix-authored rest nodes are unsupported");
    return {
        translation: (node.translation || [0, 0, 0]).slice(),
        rotation: normalizeQuaternion(node.rotation || [0, 0, 0, 1]),
        scale: (node.scale || [1, 1, 1]).slice()
    };
}

function matrixFromTrs(trs) {
    const translation = trs.translation;
    const rotation = normalizeQuaternion(trs.rotation);
    const scale = trs.scale;
    const x = rotation[0];
    const y = rotation[1];
    const z = rotation[2];
    const w = rotation[3];
    const x2 = x + x;
    const y2 = y + y;
    const z2 = z + z;
    const xx = x * x2;
    const xy = x * y2;
    const xz = x * z2;
    const yy = y * y2;
    const yz = y * z2;
    const zz = z * z2;
    const wx = w * x2;
    const wy = w * y2;
    const wz = w * z2;
    return [
        (1 - (yy + zz)) * scale[0],
        (xy + wz) * scale[0],
        (xz - wy) * scale[0],
        0,
        (xy - wz) * scale[1],
        (1 - (xx + zz)) * scale[1],
        (yz + wx) * scale[1],
        0,
        (xz + wy) * scale[2],
        (yz - wx) * scale[2],
        (1 - (xx + yy)) * scale[2],
        0,
        translation[0],
        translation[1],
        translation[2],
        1
    ];
}

function multiplyMatrices(left, right) {
    const output = new Array(16).fill(0);
    for (let column = 0; column < 4; column += 1) {
        for (let row = 0; row < 4; row += 1) {
            for (let shared = 0; shared < 4; shared += 1) {
                output[column * 4 + row] += left[shared * 4 + row] * right[column * 4 + shared];
            }
        }
    }
    return output;
}

function invertMatrix(matrix) {
    const output = new Array(16);
    const a00 = matrix[0];
    const a01 = matrix[1];
    const a02 = matrix[2];
    const a03 = matrix[3];
    const a10 = matrix[4];
    const a11 = matrix[5];
    const a12 = matrix[6];
    const a13 = matrix[7];
    const a20 = matrix[8];
    const a21 = matrix[9];
    const a22 = matrix[10];
    const a23 = matrix[11];
    const a30 = matrix[12];
    const a31 = matrix[13];
    const a32 = matrix[14];
    const a33 = matrix[15];
    const b00 = a00 * a11 - a01 * a10;
    const b01 = a00 * a12 - a02 * a10;
    const b02 = a00 * a13 - a03 * a10;
    const b03 = a01 * a12 - a02 * a11;
    const b04 = a01 * a13 - a03 * a11;
    const b05 = a02 * a13 - a03 * a12;
    const b06 = a20 * a31 - a21 * a30;
    const b07 = a20 * a32 - a22 * a30;
    const b08 = a20 * a33 - a23 * a30;
    const b09 = a21 * a32 - a22 * a31;
    const b10 = a21 * a33 - a23 * a31;
    const b11 = a22 * a33 - a23 * a32;
    let determinant = b00 * b11 - b01 * b10 + b02 * b09
        + b03 * b08 - b04 * b07 + b05 * b06;
    assert(Math.abs(determinant) > 1e-12, "rest matrix is not invertible");
    determinant = 1 / determinant;
    output[0] = (a11 * b11 - a12 * b10 + a13 * b09) * determinant;
    output[1] = (a02 * b10 - a01 * b11 - a03 * b09) * determinant;
    output[2] = (a31 * b05 - a32 * b04 + a33 * b03) * determinant;
    output[3] = (a22 * b04 - a21 * b05 - a23 * b03) * determinant;
    output[4] = (a12 * b08 - a10 * b11 - a13 * b07) * determinant;
    output[5] = (a00 * b11 - a02 * b08 + a03 * b07) * determinant;
    output[6] = (a32 * b02 - a30 * b05 - a33 * b01) * determinant;
    output[7] = (a20 * b05 - a22 * b02 + a23 * b01) * determinant;
    output[8] = (a10 * b10 - a11 * b08 + a13 * b06) * determinant;
    output[9] = (a01 * b08 - a00 * b10 - a03 * b06) * determinant;
    output[10] = (a30 * b04 - a31 * b02 + a33 * b00) * determinant;
    output[11] = (a21 * b02 - a20 * b04 - a23 * b00) * determinant;
    output[12] = (a11 * b07 - a10 * b09 - a12 * b06) * determinant;
    output[13] = (a00 * b09 - a01 * b07 + a02 * b06) * determinant;
    output[14] = (a31 * b01 - a30 * b03 - a32 * b00) * determinant;
    output[15] = (a20 * b03 - a21 * b01 + a22 * b00) * determinant;
    return output;
}

function matrixDeterminant3(matrix) {
    return matrix[0] * (matrix[5] * matrix[10] - matrix[6] * matrix[9])
        - matrix[4] * (matrix[1] * matrix[10] - matrix[2] * matrix[9])
        + matrix[8] * (matrix[1] * matrix[6] - matrix[2] * matrix[5]);
}

function quaternionFromRotationMatrix(matrix) {
    const m00 = matrix[0];
    const m01 = matrix[4];
    const m02 = matrix[8];
    const m10 = matrix[1];
    const m11 = matrix[5];
    const m12 = matrix[9];
    const m20 = matrix[2];
    const m21 = matrix[6];
    const m22 = matrix[10];
    const trace = m00 + m11 + m22;
    let output;
    if (trace > 0) {
        const scale = Math.sqrt(trace + 1) * 2;
        output = [(m21 - m12) / scale, (m02 - m20) / scale, (m10 - m01) / scale, scale / 4];
    } else if (m00 > m11 && m00 > m22) {
        const scale = Math.sqrt(1 + m00 - m11 - m22) * 2;
        output = [scale / 4, (m01 + m10) / scale, (m02 + m20) / scale, (m21 - m12) / scale];
    } else if (m11 > m22) {
        const scale = Math.sqrt(1 + m11 - m00 - m22) * 2;
        output = [(m01 + m10) / scale, scale / 4, (m12 + m21) / scale, (m02 - m20) / scale];
    } else {
        const scale = Math.sqrt(1 + m22 - m00 - m11) * 2;
        output = [(m02 + m20) / scale, (m12 + m21) / scale, scale / 4, (m10 - m01) / scale];
    }
    return normalizeQuaternion(output);
}

function decomposeMatrix(matrix) {
    const scale = [
        vectorLength([matrix[0], matrix[1], matrix[2]]),
        vectorLength([matrix[4], matrix[5], matrix[6]]),
        vectorLength([matrix[8], matrix[9], matrix[10]])
    ];
    assert(scale.every((value) => value > 1e-12), "retargeted matrix has a zero scale axis");
    if (matrixDeterminant3(matrix) < 0) {
        scale[0] = -scale[0];
    }
    const rotationMatrix = matrix.slice();
    for (let row = 0; row < 3; row += 1) {
        rotationMatrix[row] /= scale[0];
        rotationMatrix[4 + row] /= scale[1];
        rotationMatrix[8 + row] /= scale[2];
    }
    const trs = {
        translation: [matrix[12], matrix[13], matrix[14]],
        rotation: quaternionFromRotationMatrix(rotationMatrix),
        scale
    };
    const reconstructed = matrixFromTrs(trs);
    const residual = Math.max(...matrix.map((value, index) => {
        return Math.abs(value - reconstructed[index]);
    }));
    return { trs, residual };
}

function parentIndices(document) {
    const parents = new Array(document.nodes.length).fill(-1);
    document.nodes.forEach((node, parentIndex) => {
        (node.children || []).forEach((childIndex) => {
            assert(parents[childIndex] === -1, "node has multiple parents");
            parents[childIndex] = parentIndex;
        });
    });
    return parents;
}

function uniqueNodeMap(document) {
    const output = new Map();
    document.nodes.forEach((node, index) => {
        if (!node.name) {
            return;
        }
        assert(!output.has(node.name), "duplicate node name: " + node.name);
        output.set(node.name, index);
    });
    return output;
}

function trackMap(document, binary, animation) {
    const output = new Map();
    animation.channels.forEach((channel) => {
        assert(channel.target && typeof channel.target.node === "number", "animation target is invalid");
        const pathName = channel.target.path;
        assert(["translation", "rotation", "scale"].includes(pathName), "unsupported animation path");
        const key = channel.target.node + ":" + pathName;
        assert(!output.has(key), "duplicate animation channel: " + key);
        const sampler = animation.samplers[channel.sampler];
        assert(sampler, "animation sampler is missing");
        const times = readAccessor(document, binary, sampler.input).map((value) => value[0]);
        const values = readAccessor(document, binary, sampler.output);
        output.set(key, {
            inputAccessor: sampler.input,
            interpolation: sampler.interpolation || "LINEAR",
            pathName,
            times,
            values
        });
    });
    return output;
}

function animatedTrsAt(document, tracks, nodeIndex, timeSeconds) {
    const rest = nodeTrs(document.nodes[nodeIndex]);
    ["translation", "rotation", "scale"].forEach((pathName) => {
        const track = tracks.get(nodeIndex + ":" + pathName);
        if (track) {
            rest[pathName] = sampleTrack(track, timeSeconds);
        }
    });
    return rest;
}

function appendFloatAccessor(document, binaryParts, state, values, type, includeBounds) {
    const componentCount = COMPONENTS[type];
    assert(componentCount && values.length > 0, "cannot append an empty accessor");
    const flat = values.flat();
    assert(flat.length === values.length * componentCount, "accessor component count mismatch");
    const alignedOffset = align4(state.length);
    if (alignedOffset > state.length) {
        binaryParts.push(Buffer.alloc(alignedOffset - state.length));
        state.length = alignedOffset;
    }
    const data = Buffer.alloc(flat.length * 4);
    flat.forEach((value, index) => {
        assert(Number.isFinite(value), "generated accessor contains a non-finite value");
        data.writeFloatLE(value, index * 4);
    });
    const bufferViewIndex = document.bufferViews.length;
    document.bufferViews.push({
        buffer: 0,
        byteOffset: state.length,
        byteLength: data.length
    });
    binaryParts.push(data);
    state.length += data.length;
    const accessor = {
        bufferView: bufferViewIndex,
        // Creator 2.4.9's glTF importer does not reliably apply the glTF 2.0
        // default when this field is omitted; keep the zero explicit.
        byteOffset: 0,
        componentType: 5126,
        count: values.length,
        type
    };
    if (includeBounds) {
        accessor.min = new Array(componentCount).fill(Number.POSITIVE_INFINITY);
        accessor.max = new Array(componentCount).fill(Number.NEGATIVE_INFINITY);
        values.forEach((value) => value.forEach((part, index) => {
            accessor.min[index] = Math.min(accessor.min[index], part);
            accessor.max[index] = Math.max(accessor.max[index], part);
        }));
    }
    const accessorIndex = document.accessors.length;
    document.accessors.push(accessor);
    return accessorIndex;
}

function firstAnimationPath(document, binary, animationName, nodeName, pathName) {
    const animation = document.animations.find((item) => item.name === animationName);
    assert(animation, "animation is missing: " + animationName);
    const nodeIndex = document.nodes.findIndex((node) => node.name === nodeName);
    assert(nodeIndex >= 0, "node is missing: " + nodeName);
    const channel = animation.channels.find((item) => {
        return item.target.node === nodeIndex && item.target.path === pathName;
    });
    assert(channel, animationName + " " + nodeName + " " + pathName + " is missing");
    const sampler = animation.samplers[channel.sampler];
    return readAccessor(document, binary, sampler.output)[0];
}

function loadSource(specification, sourceFbxDirectory) {
    const equals = specification.indexOf("=");
    assert(equals > 0, "source specification must be Name=/path/to/file.gltf");
    const name = specification.slice(0, equals);
    const gltfPath = path.resolve(specification.slice(equals + 1));
    assert(EXPECTED_DANCER_FBX_SHA256[name], "unexpected source animation: " + name);
    const gltfBytes = fs.readFileSync(gltfPath);
    const document = JSON.parse(gltfBytes.toString("utf8"));
    assert(document.asset && document.asset.version === "2.0", name + " must be glTF 2.0");
    assert(document.asset.generator === "FBX2glTF", name + " must come directly from FBX2glTF");
    assert(document.buffers && document.buffers.length === 1, name + " must use one buffer");
    const bufferUri = document.buffers[0].uri;
    assert(bufferUri && !bufferUri.startsWith("data:"), name + " must use an external buffer");
    const binary = fs.readFileSync(path.resolve(path.dirname(gltfPath), bufferUri));
    assert(binary.length === document.buffers[0].byteLength, name + " buffer length mismatch");
    assert(document.animations && document.animations.length === 1, name + " must contain one animation");
    assert(document.skins && document.skins.length === 1, name + " must contain one skin");
    assert(document.images && document.images.length === 1, name + " must contain one source texture");
    assert(document.images[0].uri === ORIGINAL_DANCER_TEXTURE_FACTS.sourceName,
        name + " source texture URI changed");
    const imagePath = path.resolve(path.dirname(gltfPath), document.images[0].uri);
    const image = fs.readFileSync(imagePath);
    const imageFacts = pngFacts(image);
    assert(sha256(image) === ORIGINAL_DANCER_TEXTURE_FACTS.sourceSha256,
        name + " embedded texture hash changed");
    assert(imageFacts.width === ORIGINAL_DANCER_TEXTURE_FACTS.sourceWidth
        && imageFacts.height === ORIGINAL_DANCER_TEXTURE_FACTS.sourceHeight
        && imageFacts.hasAlpha === ORIGINAL_DANCER_TEXTURE_FACTS.sourceHasAlpha,
    name + " embedded texture dimensions/alpha changed");
    const sourceFbxPath = path.join(sourceFbxDirectory, name + ".fbx");
    const sourceFbxSha256 = sha256(fs.readFileSync(sourceFbxPath));
    const rawExpected = EXPECTED_RAW_CONVERSION[name];
    assert(sha256(gltfBytes) === rawExpected.gltfSha256,
        name + " direct FBX2glTF document changed");
    assert(sha256(binary) === rawExpected.binarySha256,
        name + " direct FBX2glTF buffer changed");
    return {
        name,
        gltfPath,
        document,
        binary,
        animation: document.animations[0],
        sourceFbxSha256,
        sourceGltfSha256: sha256(gltfBytes),
        sourceBinarySha256: sha256(binary),
        sourceTextureSha256: sha256(image)
    };
}

function main() {
    const argumentsList = process.argv.slice(2);
    assert(argumentsList.length === 12,
        "usage: retarget source-fbx-dir output.gltf output.bin runtime.jpg texture-uri Name=source.gltf ...");
    const sourceFbxDirectory = path.resolve(argumentsList[0]);
    const outputGltfPath = path.resolve(argumentsList[1]);
    const outputBinPath = path.resolve(argumentsList[2]);
    const runtimeTexturePath = path.resolve(argumentsList[3]);
    const runtimeTextureUri = argumentsList[4];
    const sources = argumentsList.slice(5).map((specification) => {
        return loadSource(specification, sourceFbxDirectory);
    });
    assert(
        JSON.stringify(sources.map((source) => source.name))
            === JSON.stringify(DANCER_SOURCE_NAMES),
        "sources must follow the audited seven-file order"
    );
    const sourcesByName = new Map(sources.map((source) => [source.name, source]));
    assertExpectedSourceHashes(Object.fromEntries(sources.map((source) => {
        return [source.name, source.sourceFbxSha256];
    })));

    const base = sourcesByName.get(ORIGINAL_DANCER_MODEL_FACTS.sourceName);
    const baseDocument = base.document;
    const baseMeshFacts = meshFacts(baseDocument);
    assertOriginalModelFacts({
        sourceName: base.name,
        sourceFbxSha256: base.sourceFbxSha256,
        nodeCount: baseMeshFacts.nodeCount,
        positionCount: baseMeshFacts.positionCount,
        triangleCount: baseMeshFacts.triangleCount,
        jointCount: baseMeshFacts.jointCount
    });
    const baseWeights = baseDocument.accessors[baseMeshFacts.weightsAccessor];
    assert(baseWeights.componentType === 5126 && !baseWeights.normalized,
        "base skin weights must remain non-normalized Float32");
    const weightNormalization = normalizeSkinWeights(
        baseDocument,
        base.binary,
        baseMeshFacts.weightsAccessor
    );
    const baseBinary = weightNormalization.binary;
    const baseCompatibility = {
        hierarchySha256: hierarchyFingerprint(baseDocument),
        texcoordSha256: accessorFingerprint(baseDocument, base.binary, baseMeshFacts.texcoordAccessor),
        jointsSha256: accessorFingerprint(baseDocument, base.binary, baseMeshFacts.jointsAccessor),
        weightsSha256: accessorFingerprint(baseDocument, base.binary, baseMeshFacts.weightsAccessor),
        indicesSha256: accessorFingerprint(baseDocument, base.binary, baseMeshFacts.indicesAccessor),
        materialSha256: sha256(Buffer.from(JSON.stringify({
            samplers: baseDocument.samplers,
            textures: baseDocument.textures,
            materials: baseDocument.materials
        })))
    };
    sources.forEach((source) => {
        const facts = meshFacts(source.document);
        assert(facts.nodeCount === ORIGINAL_DANCER_MODEL_FACTS.nodeCount,
            source.name + " node count changed");
        assert(facts.positionCount === ORIGINAL_DANCER_MODEL_FACTS.positionCount,
            source.name + " position count changed");
        assert(facts.triangleCount === ORIGINAL_DANCER_MODEL_FACTS.triangleCount,
            source.name + " triangle count changed");
        assert(facts.jointCount === ORIGINAL_DANCER_MODEL_FACTS.jointCount,
            source.name + " joint count changed");
        const compatibility = {
            hierarchySha256: hierarchyFingerprint(source.document),
            texcoordSha256: accessorFingerprint(source.document, source.binary, facts.texcoordAccessor),
            jointsSha256: accessorFingerprint(source.document, source.binary, facts.jointsAccessor),
            weightsSha256: accessorFingerprint(source.document, source.binary, facts.weightsAccessor),
            indicesSha256: accessorFingerprint(source.document, source.binary, facts.indicesAccessor),
            materialSha256: sha256(Buffer.from(JSON.stringify({
                samplers: source.document.samplers,
                textures: source.document.textures,
                materials: source.document.materials
            })))
        };
        assert(JSON.stringify(compatibility) === JSON.stringify(baseCompatibility),
            source.name + " mesh UV/skin/material compatibility changed");
    });

    const rawIdle = sourcesByName.get("IdleSway");
    const danceCombo = sourcesByName.get("DanceCombo");
    const rawIdleMatchesDanceCombo = rawIdle.sourceGltfSha256 === danceCombo.sourceGltfSha256
        && rawIdle.sourceBinarySha256 === danceCombo.sourceBinarySha256;
    assertIdleAliasPolicy({
        ...DANCER_CLIP_SOURCES,
        rawIdleMatchesDanceCombo,
        outputIdleSharesAccessors: true
    });

    const runtimeTexture = fs.readFileSync(runtimeTexturePath);
    assert(runtimeTexture.length === ORIGINAL_DANCER_TEXTURE_FACTS.runtimeBytes,
        "runtime texture byte length changed");
    assert(sha256(runtimeTexture) === ORIGINAL_DANCER_TEXTURE_FACTS.runtimeSha256,
        "runtime texture SHA-256 changed");
    assert(runtimeTexture[0] === 0xff && runtimeTexture[1] === 0xd8,
        "runtime texture is not JPEG");
    assert(runtimeTextureUri === ORIGINAL_DANCER_TEXTURE_FACTS.runtimeName,
        "runtime texture URI must be semantic and stable");

    const outputDocument = clone(baseDocument);
    outputDocument.asset.generator = "FBX2glTF 2.0 + deterministic rest-space animation merge";
    outputDocument.buffers[0].uri = "../import/BullDancer.bin";
    outputDocument.images[0].name = ORIGINAL_DANCER_TEXTURE_FACTS.runtimeName;
    outputDocument.images[0].uri = runtimeTextureUri;
    outputDocument.meshes[0].name = "OriginalDancer";
    outputDocument.animations = [];
    const binaryParts = [baseBinary];
    const binaryState = { length: baseBinary.length };
    const targetNodes = uniqueNodeMap(baseDocument);
    const targetParents = parentIndices(baseDocument);
    const idleHipsFirst = firstAnimationPath(
        baseDocument,
        baseBinary,
        base.animation.name,
        "Hips",
        "translation"
    );
    const mappingRecords = new Map();
    const summaries = {};
    const retargetedAnimations = new Map();
    let maximumRestRecoveryError = 0;
    let maximumTrsResidual = 0;
    let maximumQuaternionNormError = 0;

    ["DanceCombo", "ResultPose", "DanceCombo2", "ResultPose2", "ResultPose3"].forEach((name) => {
        const source = sourcesByName.get(name);
        const sourceNodes = uniqueNodeMap(source.document);
        assert(sourceNodes.size > 0, source.name + " source node names are missing");
        const sourceParents = parentIndices(source.document);
        const tracks = trackMap(source.document, source.binary, source.animation);
        const inputAccessorMap = new Map();
        const outputAnimation = { name: source.name, samplers: [], channels: [] };
        let sourceDuration = 0;
        let channelCount = 0;
        let sourceIndexMismatchCount = 0;
        let restMismatchChannelCount = 0;
        let maximumSourceTargetRestDelta = 0;
        let hipsOutputValues = null;

        source.animation.channels.forEach((sourceChannel) => {
            const sourceNodeIndex = sourceChannel.target.node;
            const sourceNode = source.document.nodes[sourceNodeIndex];
            const pathName = sourceChannel.target.path;
            const targetNodeIndex = targetNodes.get(sourceNode.name);
            assert(typeof targetNodeIndex === "number",
                source.name + " target bone is missing: " + sourceNode.name);
            const sourceParentIndex = sourceParents[sourceNodeIndex];
            const targetParentIndex = targetParents[targetNodeIndex];
            const sourceParentName = sourceParentIndex >= 0
                ? source.document.nodes[sourceParentIndex].name : null;
            const targetParentName = targetParentIndex >= 0
                ? baseDocument.nodes[targetParentIndex].name : null;
            assert(sourceParentName === targetParentName,
                source.name + " parent hierarchy differs for " + sourceNode.name);
            if (sourceNodeIndex !== targetNodeIndex) {
                sourceIndexMismatchCount += 1;
            }
            const mappingKey = sourceNode.name;
            const existingMapping = mappingRecords.get(mappingKey);
            const mapping = {
                bone: sourceNode.name,
                sourceNode: sourceNodeIndex,
                targetNode: targetNodeIndex,
                parent: sourceParentName
            };
            if (existingMapping) {
                assert(JSON.stringify(existingMapping) === JSON.stringify(mapping),
                    "source rig mapping changed between animation files");
            } else {
                mappingRecords.set(mappingKey, mapping);
            }

            const sourceRestMatrix = matrixFromTrs(nodeTrs(sourceNode));
            const targetRestMatrix = matrixFromTrs(nodeTrs(baseDocument.nodes[targetNodeIndex]));
            const restDelta = Math.max(...sourceRestMatrix.map((value, index) => {
                return Math.abs(value - targetRestMatrix[index]);
            }));
            maximumSourceTargetRestDelta = Math.max(maximumSourceTargetRestDelta, restDelta);
            if (restDelta > 1e-9) {
                restMismatchChannelCount += 1;
            }
            const correction = multiplyMatrices(targetRestMatrix, invertMatrix(sourceRestMatrix));
            const recoveredRest = multiplyMatrices(correction, sourceRestMatrix);
            maximumRestRecoveryError = Math.max(
                maximumRestRecoveryError,
                ...recoveredRest.map((value, index) => Math.abs(value - targetRestMatrix[index]))
            );

            const sourceSampler = source.animation.samplers[sourceChannel.sampler];
            const sourceTrack = tracks.get(sourceNodeIndex + ":" + pathName);
            assert(sourceTrack, "source track is missing");
            sourceDuration = Math.max(sourceDuration, sourceTrack.times[sourceTrack.times.length - 1]);
            let targetInputAccessor = inputAccessorMap.get(sourceSampler.input);
            if (typeof targetInputAccessor !== "number") {
                targetInputAccessor = appendFloatAccessor(
                    outputDocument,
                    binaryParts,
                    binaryState,
                    sourceTrack.times.map((time) => [time]),
                    "SCALAR",
                    true
                );
                inputAccessorMap.set(sourceSampler.input, targetInputAccessor);
            }

            let previousQuaternion = null;
            const outputValues = sourceTrack.times.map((time) => {
                const sourceAnimatedMatrix = matrixFromTrs(
                    animatedTrsAt(source.document, tracks, sourceNodeIndex, time)
                );
                const retargeted = decomposeMatrix(multiplyMatrices(correction, sourceAnimatedMatrix));
                maximumTrsResidual = Math.max(maximumTrsResidual, retargeted.residual);
                let value = retargeted.trs[pathName].slice();
                if (pathName === "rotation") {
                    value = normalizeQuaternion(value);
                    if (previousQuaternion && quaternionDot(previousQuaternion, value) < 0) {
                        value = value.map((part) => -part);
                    }
                    previousQuaternion = value;
                    maximumQuaternionNormError = Math.max(
                        maximumQuaternionNormError,
                        Math.abs(vectorLength(value) - 1)
                    );
                }
                return value;
            });
            if (sourceNode.name === "Hips" && pathName === "translation") {
                const offset = idleHipsFirst.map((value, index) => value - outputValues[0][index]);
                outputValues.forEach((value) => value.forEach((_part, index) => {
                    value[index] += offset[index];
                }));
                hipsOutputValues = outputValues;
            }
            const type = pathName === "rotation" ? "VEC4" : "VEC3";
            const targetOutputAccessor = appendFloatAccessor(
                outputDocument,
                binaryParts,
                binaryState,
                outputValues,
                type,
                false
            );
            const samplerIndex = outputAnimation.samplers.length;
            outputAnimation.samplers.push({
                input: targetInputAccessor,
                output: targetOutputAccessor,
                interpolation: sourceSampler.interpolation || "LINEAR"
            });
            outputAnimation.channels.push({
                sampler: samplerIndex,
                target: { node: targetNodeIndex, path: pathName }
            });
            channelCount += 1;
        });

        assert(hipsOutputValues, source.name + " Hips translation output is missing");
        hipsOutputValues[0].forEach((value, index) => {
            assert(Math.abs(value - idleHipsFirst[index]) <= 1e-7,
                source.name + " Hips baseline failed");
        });
        assert(restMismatchChannelCount === channelCount,
            source.name + " no longer proves rest-space correction is necessary");
        retargetedAnimations.set(source.name, outputAnimation);
        summaries[source.name] = {
            sourceNodeCount: source.document.nodes.length,
            sourceSkinJointCount: source.document.skins[0].joints.length,
            channelCount,
            sourceIndexMismatchCount,
            restMismatchChannelCount,
            maximumSourceTargetRestDelta,
            duration: sourceDuration,
            sourceRawGltfSha256: source.sourceGltfSha256,
            sourceRawBinarySha256: source.sourceBinarySha256,
            sourceFbxSha256: source.sourceFbxSha256,
            sourceTextureSha256: source.sourceTextureSha256
        };
    });

    assert(maximumRestRecoveryError <= 1e-9, "rest-space recovery error is too large");
    assert(maximumTrsResidual <= 0.0001, "retargeted TRS contains material shear");
    assert(maximumQuaternionNormError <= 1e-12, "retargeted quaternion normalization drifted");
    const menuIdle = clone(base.animation);
    menuIdle.name = "IdleSway";
    const gameplayIdle = clone(base.animation);
    gameplayIdle.name = "IdleSway0";
    assert(JSON.stringify(animationAccessors(menuIdle)) === JSON.stringify(animationAccessors(gameplayIdle)),
        "idle aliases must share source accessors");
    outputDocument.animations = [
        menuIdle,
        retargetedAnimations.get("DanceCombo"),
        retargetedAnimations.get("ResultPose"),
        retargetedAnimations.get("DanceCombo2"),
        retargetedAnimations.get("ResultPose2"),
        retargetedAnimations.get("ResultPose3"),
        gameplayIdle
    ];
    outputDocument.buffers[0].byteLength = binaryState.length;
    outputDocument.extras = outputDocument.extras || {};
    outputDocument.extras.runtimeDerivation = {
        model: {
            sourceName: base.name,
            sourceFbxSha256: base.sourceFbxSha256,
            sourceRawGltfSha256: base.sourceGltfSha256,
            sourceRawBinarySha256: base.sourceBinarySha256,
            nodeCount: baseMeshFacts.nodeCount,
            positionCount: baseMeshFacts.positionCount,
            triangleCount: baseMeshFacts.triangleCount,
            jointCount: baseMeshFacts.jointCount,
            weightNormalization: {
                operation: "divide each Float32 VEC4 by its per-vertex sum",
                vertexCount: weightNormalization.vertexCount,
                maximumInputSumError: weightNormalization.maximumInputSumError,
                maximumOutputSumError: weightNormalization.maximumOutputSumError,
                outputBaseBinarySha256: weightNormalization.outputSha256
            },
            compatibility: baseCompatibility
        },
        texture: {
            sourceName: ORIGINAL_DANCER_TEXTURE_FACTS.sourceName,
            sourceSha256: ORIGINAL_DANCER_TEXTURE_FACTS.sourceSha256,
            sourceWidth: ORIGINAL_DANCER_TEXTURE_FACTS.sourceWidth,
            sourceHeight: ORIGINAL_DANCER_TEXTURE_FACTS.sourceHeight,
            sourceHasAlpha: ORIGINAL_DANCER_TEXTURE_FACTS.sourceHasAlpha,
            runtimeName: runtimeTextureUri,
            runtimeSha256: sha256(runtimeTexture),
            runtimeWidth: ORIGINAL_DANCER_TEXTURE_FACTS.runtimeWidth,
            runtimeHeight: ORIGINAL_DANCER_TEXTURE_FACTS.runtimeHeight,
            runtimeBytes: runtimeTexture.length,
            jpegQuality: ORIGINAL_DANCER_TEXTURE_FACTS.jpegQuality
        },
        clipSources: DANCER_CLIP_SOURCES,
        rawIdleInspection: {
            sourceFbxSha256: rawIdle.sourceFbxSha256,
            matchesDanceCombo: rawIdleMatchesDanceCombo,
            excludedFromRuntime: true
        },
        idleAlias: {
            menu: "IdleSway0 source animation",
            gameplay: "IdleSway0 source animation",
            sharedAccessors: true
        },
        hipsTranslationBaseline: "IdleSway0",
        alignedAnimations: [
            "DanceCombo",
            "DanceCombo2",
            "ResultPose",
            "ResultPose2",
            "ResultPose3"
        ],
        operation: "per-clip constant translation offset",
        retarget: {
            mapping: "unique bone name with identical parent name",
            restSpace: "node-local TRS",
            formula: "targetRestLocal * inverse(sourceRestLocal) * sourceAnimatedLocal",
            targetSkinJointCount: baseDocument.skins[0].joints.length,
            sourceConversion:
                "FBX2glTF 2.0 (Cocos Creator 2.4.9 bundled binary; no gltfpack or mesh decimation)",
            baseBinaryPrefixBytes: baseBinary.length,
            baseBinaryPrefixSha256: sha256(baseBinary),
            maximumRestRecoveryError,
            maximumTrsResidual,
            maximumQuaternionNormError,
            mappings: Array.from(mappingRecords.values()).sort((left, right) => {
                return left.bone.localeCompare(right.bone);
            }),
            animations: summaries
        }
    };

    const outputBinary = Buffer.concat(binaryParts, binaryState.length);
    assert(outputBinary.length === binaryState.length, "generated binary length mismatch");
    fs.mkdirSync(path.dirname(outputGltfPath), { recursive: true });
    fs.mkdirSync(path.dirname(outputBinPath), { recursive: true });
    fs.writeFileSync(outputGltfPath, JSON.stringify(outputDocument));
    fs.writeFileSync(outputBinPath, outputBinary);
    console.log(JSON.stringify({
        outputGltfPath,
        outputBinPath,
        outputBytes: outputBinary.length,
        outputSha256: sha256(outputBinary),
        animationNames: outputDocument.animations.map((animation) => animation.name),
        model: outputDocument.extras.runtimeDerivation.model,
        texture: outputDocument.extras.runtimeDerivation.texture,
        maximumRestRecoveryError,
        maximumTrsResidual,
        maximumQuaternionNormError,
        summaries
    }, null, 2));
}

try {
    main();
} catch (error) {
    console.error("error: dancer retarget failed: " + error.message);
    process.exitCode = 1;
}
