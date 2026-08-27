#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
DEFAULT_CREATOR="/Applications/Cocos/Creator/2.4.9/CocosCreator.app/Contents/MacOS/CocosCreator"
CREATOR_BIN=${COCOS_CREATOR:-$DEFAULT_CREATOR}
BUILD_ROOT="$PROJECT_ROOT/build"
WEB_DIR="$BUILD_ROOT/web-mobile"

if [ ! -x "$CREATOR_BIN" ]; then
  echo "error: Cocos Creator 2.4.9 not found at $CREATOR_BIN" >&2
  echo "Set COCOS_CREATOR to the 2.4.9 executable path." >&2
  exit 1
fi

rm -rf "$WEB_DIR"
mkdir -p "$BUILD_ROOT"

# Creator 2.4.9 calls the modern mainBundleIsRemote option mainIsRemote.
BUILD_OPTIONS="platform=web-mobile;buildPath=$BUILD_ROOT;debug=false;sourceMaps=false;mainIsRemote=false;md5Cache=false;webOrientation=landscape"
"$CREATOR_BIN" --path "$PROJECT_ROOT" --build "$BUILD_OPTIONS"

if [ ! -f "$WEB_DIR/index.html" ]; then
  echo "error: Cocos build did not produce $WEB_DIR/index.html" >&2
  exit 1
fi

# Extra custom-template files are normally copied by Creator; keep this step
# explicit so CLI builds remain stable across clean local cache states.
if [ ! -f "$WEB_DIR/mobile-perf.js" ]; then
  cp "$PROJECT_ROOT/build-templates/web-mobile/mobile-perf.js" "$WEB_DIR/mobile-perf.js"
fi

if grep -q '<%=' "$WEB_DIR/index.html"; then
  echo "error: unresolved template placeholder found in built index.html" >&2
  exit 1
fi

if find "$WEB_DIR" -type f -name '*.map' | grep -q .; then
  echo "error: source maps were emitted even though sourceMaps=false" >&2
  exit 1
fi
if find "$WEB_DIR" -type f -name 'builda-sdk.js' | grep -q .; then
  echo "error: build output must reference, not bundle, builda-sdk.js" >&2
  exit 1
fi

echo "cocos-build=ok"
echo "web-dir=$WEB_DIR"
