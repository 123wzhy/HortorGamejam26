#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
SOURCE_DIR=${1:-"$PROJECT_ROOT/source-assets/dancer"}
OUTPUT_DIR=${2:-"$PROJECT_ROOT/assets/spine"}
FBX2GLTF=${FBX2GLTF:-/Applications/Cocos/Creator/2.4.9/CocosCreator.app/Contents/Resources/app.asar.unpacked/node_modules/fbx2gltf/bin/Darwin/FBX2glTF}

if [ ! -x "$FBX2GLTF" ]; then
  echo "error: Cocos Creator 2.4.9 FBX2glTF is unavailable: $FBX2GLTF" >&2
  exit 1
fi
if ! command -v node >/dev/null 2>&1; then
  echo "error: Node.js is required to merge dancer animations" >&2
  exit 1
fi
if [ ! -x /usr/bin/sips ]; then
  echo "error: macOS sips is required for deterministic dancer texture conversion" >&2
  exit 1
fi

WORK_DIR=$(mktemp -d "${TMPDIR:-/tmp}/hortor-dancer-rebuild.XXXXXX")
trap 'rm -rf "$WORK_DIR"' EXIT HUP INT TERM
mkdir -p "$WORK_DIR/source" "$WORK_DIR/converted" "$WORK_DIR/generated/runtime" \
  "$WORK_DIR/generated/import"

for NAME in DanceCombo DanceCombo2 IdleSway IdleSway0 ResultPose ResultPose2 ResultPose3; do
  SOURCE_FBX="$SOURCE_DIR/$NAME.fbx"
  if [ ! -f "$SOURCE_FBX" ]; then
    echo "error: audited source FBX is missing: $SOURCE_FBX" >&2
    exit 1
  fi
  cp "$SOURCE_FBX" "$WORK_DIR/source/$NAME.fbx"
  mkdir -p "$WORK_DIR/converted/$NAME"
  "$FBX2GLTF" \
    --input "$WORK_DIR/source/$NAME.fbx" \
    --output "$WORK_DIR/converted/$NAME/$NAME" \
    >"$WORK_DIR/converted/$NAME/conversion.log" 2>&1
done

/usr/bin/sips \
  -Z 2048 \
  --setProperty format jpeg \
  --setProperty formatOptions 85 \
  "$WORK_DIR/converted/IdleSway0/IdleSway0_out/Image_0.png" \
  --out "$WORK_DIR/generated/runtime/OriginalDancerAlbedo.jpg" \
  >/dev/null

node "$SCRIPT_DIR/retarget-dancer-animations.mjs" \
  "$SOURCE_DIR" \
  "$WORK_DIR/generated/runtime/BullDancer.gltf" \
  "$WORK_DIR/generated/import/BullDancer.bin" \
  "$WORK_DIR/generated/runtime/OriginalDancerAlbedo.jpg" \
  OriginalDancerAlbedo.jpg \
  "DanceCombo=$WORK_DIR/converted/DanceCombo/DanceCombo_out/DanceCombo.gltf" \
  "DanceCombo2=$WORK_DIR/converted/DanceCombo2/DanceCombo2_out/DanceCombo2.gltf" \
  "IdleSway=$WORK_DIR/converted/IdleSway/IdleSway_out/IdleSway.gltf" \
  "IdleSway0=$WORK_DIR/converted/IdleSway0/IdleSway0_out/IdleSway0.gltf" \
  "ResultPose=$WORK_DIR/converted/ResultPose/ResultPose_out/ResultPose.gltf" \
  "ResultPose2=$WORK_DIR/converted/ResultPose2/ResultPose2_out/ResultPose2.gltf" \
  "ResultPose3=$WORK_DIR/converted/ResultPose3/ResultPose3_out/ResultPose3.gltf"

mkdir -p "$OUTPUT_DIR/runtime" "$OUTPUT_DIR/import"
cp "$WORK_DIR/generated/runtime/BullDancer.gltf" "$OUTPUT_DIR/runtime/BullDancer.gltf"
cp "$WORK_DIR/generated/runtime/OriginalDancerAlbedo.jpg" \
  "$OUTPUT_DIR/runtime/OriginalDancerAlbedo.jpg"
cp "$WORK_DIR/generated/import/BullDancer.bin" "$OUTPUT_DIR/import/BullDancer.bin"

echo "dancer-rebuild=ok"
shasum -a 256 \
  "$OUTPUT_DIR/runtime/BullDancer.gltf" \
  "$OUTPUT_DIR/runtime/OriginalDancerAlbedo.jpg" \
  "$OUTPUT_DIR/import/BullDancer.bin"
