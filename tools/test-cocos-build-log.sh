#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
TEMP_ROOT=$(mktemp -d /private/tmp/hortor-cocos-log-test-XXXXXX)
cleanup() {
  rm -rf "$TEMP_ROOT"
}
trap cleanup EXIT HUP INT TERM

printf '%s\n' '[BuildaSDK] cloud-function unloaded' >"$TEMP_ROOT/benign.log"
node "$SCRIPT_DIR/check-cocos-build-log.mjs" "$TEMP_ROOT/benign.log"

printf '%s\n' 'Input file is missing: /project/assets/unrelated.bin' \
  >"$TEMP_ROOT/unrelated-missing.log"
node "$SCRIPT_DIR/check-cocos-build-log.mjs" "$TEMP_ROOT/unrelated-missing.log"

printf '%s\n' 'Error: Input file is missing: /project/assets/spine/DanceCombo.fbm/Image_0.png' \
  >"$TEMP_ROOT/missing.log"
if node "$SCRIPT_DIR/check-cocos-build-log.mjs" "$TEMP_ROOT/missing.log" >/dev/null 2>&1; then
  echo "error: missing FBX texture sidecar was not rejected" >&2
  exit 1
fi

printf '%s\n' 'Error: C:\\project\\assets\\spine\\ResultPose.fbm\\Image_0.png not found' \
  >"$TEMP_ROOT/windows-missing.log"
if node "$SCRIPT_DIR/check-cocos-build-log.mjs" "$TEMP_ROOT/windows-missing.log" >/dev/null 2>&1; then
  echo "error: Windows FBX texture sidecar path was not rejected" >&2
  exit 1
fi

printf '%s\n' 'cocos-build-log-tests=ok cases=4'
