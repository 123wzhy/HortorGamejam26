export const DANCER_SOURCE_NAMES = Object.freeze([
    "DanceCombo",
    "DanceCombo2",
    "IdleSway",
    "IdleSway0",
    "ResultPose",
    "ResultPose2",
    "ResultPose3"
]);

export const EXPECTED_DANCER_FBX_SHA256 = Object.freeze({
    DanceCombo: "77819dba876bf0539fff4ea8d5e0a9bd9b1443b5c85f87524c4008a25da7d20b",
    DanceCombo2: "196aa9da46163f84a8ff1745352f01a2f317304964aadf422605ec2662fc6eab",
    IdleSway: "0800fa5d300f161beb93968a6bc32d30ef15748fe8aa1a612a943bd95d408531",
    IdleSway0: "c0fc77ec2595efb4db4ab949729a1b4e72536fa143311d759b9febc596909f33",
    ResultPose: "c96a247c4cd5b6a7fa29006f6751078ce03c9f27273a03c11508b147888ba873",
    ResultPose2: "10f33f1c5b70771be6aaa22c9235d765fec40eda11a4b00659c44f1eb3627e19",
    ResultPose3: "94c047d02400ea73e9318d2cdf8562aebbc773182dc89072ae3ad39e5ac38413"
});

export const ORIGINAL_DANCER_MODEL_FACTS = Object.freeze({
    sourceName: "IdleSway0",
    sourceFbxSha256: EXPECTED_DANCER_FBX_SHA256.IdleSway0,
    nodeCount: 39,
    positionCount: 29568,
    triangleCount: 9856,
    jointCount: 33
});

export const ORIGINAL_DANCER_TEXTURE_FACTS = Object.freeze({
    sourceName: "Image_0.png",
    sourceSha256: "16b07bae85b73a8d2354aae7413c1caca9a736f6a5582c6da26e49b60667e83a",
    sourceWidth: 8192,
    sourceHeight: 8192,
    sourceHasAlpha: false,
    runtimeName: "OriginalDancerAlbedo.jpg",
    runtimeSha256: "72305c4f49ef8faf69046e5ca1df93380256ea4e890985c52ad56f97d9c4c6b9",
    runtimeWidth: 2048,
    runtimeHeight: 2048,
    runtimeBytes: 856999,
    jpegQuality: 85
});

export const DANCER_CLIP_SOURCES = Object.freeze({
    IdleSway: "IdleSway0",
    DanceCombo: "DanceCombo",
    ResultPose: "ResultPose",
    DanceCombo2: "DanceCombo2",
    ResultPose2: "ResultPose2",
    ResultPose3: "ResultPose3",
    IdleSway0: "IdleSway0"
});

function fail(message) {
    throw new Error(message);
}

function assert(condition, message) {
    if (!condition) {
        fail(message);
    }
}

export function assertExpectedSourceHashes(actualHashes) {
    DANCER_SOURCE_NAMES.forEach((name) => {
        assert(
            actualHashes && actualHashes[name] === EXPECTED_DANCER_FBX_SHA256[name],
            name + " FBX SHA-256 does not match the audited source"
        );
    });
    assert(
        Object.keys(actualHashes || {}).length === DANCER_SOURCE_NAMES.length,
        "dancer source hash set must contain exactly seven FBX files"
    );
}

export function assertOriginalModelFacts(actualFacts) {
    Object.keys(ORIGINAL_DANCER_MODEL_FACTS).forEach((key) => {
        assert(
            actualFacts && actualFacts[key] === ORIGINAL_DANCER_MODEL_FACTS[key],
            "original dancer model fact changed: " + key
        );
    });
}

export function assertIdleAliasPolicy(policy) {
    assert(policy && policy.IdleSway === "IdleSway0",
        "IdleSway must alias the audited IdleSway0 animation");
    assert(policy && policy.IdleSway0 === "IdleSway0",
        "gameplay idle must use IdleSway0");
    assert(policy && policy.DanceCombo === "DanceCombo",
        "first-song dance must use DanceCombo");
    assert(policy && policy.rawIdleMatchesDanceCombo === true,
        "the misleading raw IdleSway/DanceCombo identity must be proved before aliasing");
    assert(policy && policy.outputIdleSharesAccessors === true,
        "IdleSway and IdleSway0 must share animation accessors");
}
