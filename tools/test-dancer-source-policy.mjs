import assert from "assert";
import {
    DANCER_CLIP_SOURCES,
    EXPECTED_DANCER_FBX_SHA256,
    ORIGINAL_DANCER_MODEL_FACTS,
    assertExpectedSourceHashes,
    assertIdleAliasPolicy,
    assertOriginalModelFacts
} from "./dancer-source-policy.mjs";

function expectFailure(action, messagePattern, label) {
    assert.throws(action, messagePattern, label);
}

assert.doesNotThrow(() => assertExpectedSourceHashes({ ...EXPECTED_DANCER_FBX_SHA256 }));
expectFailure(
    () => assertExpectedSourceHashes({
        ...EXPECTED_DANCER_FBX_SHA256,
        IdleSway0: "0".repeat(64)
    }),
    /IdleSway0 FBX SHA-256/,
    "wrong base-source hash must fail"
);

assert.doesNotThrow(() => assertOriginalModelFacts({ ...ORIGINAL_DANCER_MODEL_FACTS }));
expectFailure(
    () => assertOriginalModelFacts({
        ...ORIGINAL_DANCER_MODEL_FACTS,
        positionCount: 44995,
        triangleCount: 96105,
        jointCount: 54
    }),
    /positionCount/,
    "the retired high-poly model must fail provenance checks"
);

const validAliasPolicy = {
    ...DANCER_CLIP_SOURCES,
    rawIdleMatchesDanceCombo: true,
    outputIdleSharesAccessors: true
};
assert.doesNotThrow(() => assertIdleAliasPolicy(validAliasPolicy));
expectFailure(
    () => assertIdleAliasPolicy({
        ...validAliasPolicy,
        IdleSway: "IdleSway"
    }),
    /IdleSway must alias/,
    "the mislabeled raw IdleSway action must never become runtime idle"
);
expectFailure(
    () => assertIdleAliasPolicy({
        ...validAliasPolicy,
        outputIdleSharesAccessors: false
    }),
    /share animation accessors/,
    "idle aliases must not duplicate animation data"
);

console.log("dancer-source-policy-tests=ok cases=7");
