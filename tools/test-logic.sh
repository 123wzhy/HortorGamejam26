#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
OUTPUT_DIR="$PROJECT_ROOT/temp/logic-tests"

if ! command -v node >/dev/null 2>&1; then
  echo "error: Node.js is required for pure logic tests" >&2
  exit 1
fi
if ! command -v tsc >/dev/null 2>&1; then
  echo "error: TypeScript compiler (tsc) is required for pure logic tests" >&2
  exit 1
fi

node "$PROJECT_ROOT/tools/verify-song-audio.mjs"
node "$PROJECT_ROOT/tools/verify-dancer-assets.mjs"
sh "$PROJECT_ROOT/tools/test-cocos-build-log.sh"
rm -rf "$OUTPUT_DIR"
tsc -p "$PROJECT_ROOT/tsconfig.logic.json"
node "$OUTPUT_DIR/tests/logic.spec.js"
