import crypto from "crypto";
import fs from "fs";
import path from "path";

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

const EXPECTED_SOURCE_FBX_SHA256 = {
    DanceCombo2: "196aa9da46163f84a8ff1745352f01a2f317304964aadf422605ec2662fc6eab",
    ResultPose2: "10f33f1c5b70771be6aaa22c9235d765fec40eda11a4b00659c44f1eb3627e19",
    ResultPose3: "94c047d02400ea73e9318d2cdf8562aebbc773182dc89072ae3ad39e5ac38413",
    IdleSway0: "c0fc77ec2595efb4db4ab949729a1b4e72536fa143311d759b9febc596909f33"
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

function loadSource(specification) {
    const equals = specification.indexOf("=");
    assert(equals > 0, "source specification must be Name=/path/to/file.gltf");
    const name = specification.slice(0, equals);
    const gltfPath = path.resolve(specification.slice(equals + 1));
    assert(EXPECTED_SOURCE_FBX_SHA256[name], "unexpected source animation: " + name);
    const document = JSON.parse(fs.readFileSync(gltfPath, "utf8"));
    assert(document.buffers && document.buffers.length === 1, name + " must use one buffer");
    const bufferUri = document.buffers[0].uri;
    assert(bufferUri && !bufferUri.startsWith("data:"), name + " must use an external buffer");
    const binary = fs.readFileSync(path.resolve(path.dirname(gltfPath), bufferUri));
    assert(binary.length === document.buffers[0].byteLength, name + " buffer length mismatch");
    assert(document.animations && document.animations.length === 1, name + " must contain one animation");
    assert(document.skins && document.skins.length === 1, name + " must contain one skin");
    return { name, gltfPath, document, binary, animation: document.animations[0] };
}

function main() {
    const argumentsList = process.argv.slice(2);
    assert(argumentsList.length === 8, "usage: retarget base.gltf base.bin output.gltf output.bin Name=source.gltf ...");
    const baseGltfPath = path.resolve(argumentsList[0]);
    const baseBinPath = path.resolve(argumentsList[1]);
    const outputGltfPath = path.resolve(argumentsList[2]);
    const outputBinPath = path.resolve(argumentsList[3]);
    const sources = argumentsList.slice(4).map(loadSource);
    assert(
        JSON.stringify(sources.map((source) => source.name))
            === JSON.stringify(["DanceCombo2", "ResultPose2", "ResultPose3", "IdleSway0"]),
        "sources must be ordered DanceCombo2, ResultPose2, ResultPose3, IdleSway0"
    );

    const baseDocument = JSON.parse(fs.readFileSync(baseGltfPath, "utf8"));
    const baseBinary = fs.readFileSync(baseBinPath);
    assert(baseDocument.buffers && baseDocument.buffers.length === 1, "base must use one buffer");
    assert(baseBinary.length === baseDocument.buffers[0].byteLength, "base buffer length mismatch");
    assert(baseDocument.skins && baseDocument.skins.length === 1, "base must contain one skin");
    assert(baseDocument.skins[0].joints.length === 54, "base target rig must keep 54 joints");
    assert(
        JSON.stringify(baseDocument.animations.map((animation) => animation.name))
            === JSON.stringify(["IdleSway", "DanceCombo", "ResultPose"]),
        "base must contain exactly the original three animations"
    );

    const outputDocument = clone(baseDocument);
    const binaryParts = [baseBinary];
    const binaryState = { length: baseBinary.length };
    const targetNodes = uniqueNodeMap(baseDocument);
    const targetParents = parentIndices(baseDocument);
    const idleHipsFirst = firstAnimationPath(
        baseDocument,
        baseBinary,
        "IdleSway",
        "Hips",
        "translation"
    );
    const mappingRecords = new Map();
    const summaries = {};
    let maximumRestRecoveryError = 0;
    let maximumTrsResidual = 0;
    let maximumQuaternionNormError = 0;

    sources.forEach((source) => {
        assert(source.document.skins[0].joints.length === 33, source.name + " source rig must have 33 joints");
        const sourceNodes = uniqueNodeMap(source.document);
        const sourceParents = parentIndices(source.document);
        const tracks = trackMap(source.document, source.binary, source.animation);
        const inputAccessorMap = new Map();
        const outputAnimation = { name: source.name, samplers: [], channels: [] };
        let sourceDuration = 0;
        let channelCount = 0;
        let sourceIndexMismatchCount = 0;
        let hipsOutputValues = null;

        source.animation.channels.forEach((sourceChannel) => {
            const sourceNodeIndex = sourceChannel.target.node;
            const sourceNode = source.document.nodes[sourceNodeIndex];
            const pathName = sourceChannel.target.path;
            const targetNodeIndex = targetNodes.get(sourceNode.name);
            assert(typeof targetNodeIndex === "number", source.name + " target bone is missing: " + sourceNode.name);
            const sourceParentIndex = sourceParents[sourceNodeIndex];
            const targetParentIndex = targetParents[targetNodeIndex];
            const sourceParentName = sourceParentIndex >= 0 ? source.document.nodes[sourceParentIndex].name : null;
            const targetParentName = targetParentIndex >= 0 ? baseDocument.nodes[targetParentIndex].name : null;
            assert(
                sourceParentName === targetParentName,
                source.name + " parent hierarchy differs for " + sourceNode.name
            );
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
                assert(
                    JSON.stringify(existingMapping) === JSON.stringify(mapping),
                    "source rig indices changed between new animation files"
                );
            } else {
                mappingRecords.set(mappingKey, mapping);
            }

            const sourceRestMatrix = matrixFromTrs(nodeTrs(sourceNode));
            const targetRestMatrix = matrixFromTrs(nodeTrs(baseDocument.nodes[targetNodeIndex]));
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
            assert(Math.abs(value - idleHipsFirst[index]) <= 1e-7, source.name + " Hips baseline failed");
        });
        assert(sourceIndexMismatchCount > 0, source.name + " did not prove name-based node mapping");
        outputDocument.animations.push(outputAnimation);
        summaries[source.name] = {
            sourceNodeCount: source.document.nodes.length,
            sourceSkinJointCount: source.document.skins[0].joints.length,
            channelCount,
            sourceIndexMismatchCount,
            duration: sourceDuration,
            sourceOptimizedGltfSha256: sha256(fs.readFileSync(source.gltfPath)),
            sourceFbxSha256: EXPECTED_SOURCE_FBX_SHA256[source.name]
        };
    });

    assert(maximumRestRecoveryError <= 1e-9, "rest-space recovery error is too large");
    assert(maximumTrsResidual <= 0.0001, "retargeted TRS contains material shear");
    assert(maximumQuaternionNormError <= 1e-12, "retargeted quaternion normalization drifted");
    outputDocument.buffers[0].byteLength = binaryState.length;
    outputDocument.extras = outputDocument.extras || {};
    outputDocument.extras.runtimeDerivation = {
        hipsTranslationBaseline: "IdleSway",
        alignedAnimations: [
            "DanceCombo",
            "DanceCombo2",
            "IdleSway0",
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
            sourceConversion: "FBX2glTF 2.0 then gltfpack 1.2 -si 0.2 -sa -noq -kn -ac (30 Hz default)",
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
