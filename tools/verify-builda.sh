#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
WEB_DIR="$PROJECT_ROOT/build/web-mobile"
ZIP_PATH="$PROJECT_ROOT/build/builda-web.zip"
ASSETS_ZIP_PATH="$PROJECT_ROOT/build/builda-assets.zip"

node "$PROJECT_ROOT/tools/verify-song-audio.mjs"
"$PROJECT_ROOT/tools/build-web.sh"

INDEX="$WEB_DIR/index.html"
MOBILE_LINE=$(awk '/<script src="mobile-perf.js"><\/script>/{ print NR; exit }' "$INDEX")
SDK_LINE=$(awk '/<script src="builda-sdk.js"><\/script>/{ print NR; exit }' "$INDEX")
HEAD_END_LINE=$(awk '/<\/head>/{ print NR; exit }' "$INDEX")

if [ -z "$MOBILE_LINE" ] || [ -z "$SDK_LINE" ] || [ -z "$HEAD_END_LINE" ]; then
  echo "error: index.html is missing required head scripts" >&2
  exit 1
fi
if [ "$MOBILE_LINE" -ge "$SDK_LINE" ] || [ "$SDK_LINE" -ge "$HEAD_END_LINE" ]; then
  echo "error: expected mobile-perf.js before builda-sdk.js inside head" >&2
  exit 1
fi

rm -f "$ZIP_PATH"
(cd "$WEB_DIR" && zip -q -r "$ZIP_PATH" . -x '*.DS_Store')

ZIP_LIST=$(unzip -Z1 "$ZIP_PATH")
if ! printf '%s\n' "$ZIP_LIST" | grep -qx 'index.html'; then
  echo "error: bundle root does not contain index.html" >&2
  exit 1
fi
if printf '%s\n' "$ZIP_LIST" | grep -Eq '(^|/)builda-sdk(\.min)?\.js$'; then
  echo "error: Builda SDK JS must not be included in the zip" >&2
  exit 1
fi
if printf '%s\n' "$ZIP_LIST" | grep -Eq '\.map$'; then
  echo "error: source maps must not be included in the zip" >&2
  exit 1
fi
if printf '%s\n' "$ZIP_LIST" | grep -Eq '\.(ts|d\.ts)$'; then
  echo "error: TypeScript source must not be included in the zip" >&2
  exit 1
fi
if printf '%s\n' "$ZIP_LIST" | grep -Eiq '\.(mp3|ogg|wav)$'; then
  echo "error: Builda host audio must stay in the external assets zip" >&2
  exit 1
fi

ART_CONFIG="$WEB_DIR/assets/texture/config.json"
if [ ! -f "$ART_CONFIG" ]; then
  echo "error: runtime texture bundle was not built" >&2
  exit 1
fi
ART_COUNT=0
for ART_NAME in BackGround logo menuLogo todayTaskPanel songSelectPanel startBtn settingBtn rankBtn helpBtn leftArrow downArrow upArrow rightArrow leftArrow2 downArrow2 upArrow2 rightArrow2 gameplayDancer discoBall danceBtnA pauseBtn stonePanel perfectBadge starFilled starEmpty songPreviewPlay songPreviewPause songRowSelected songRowIdle; do
  if ! grep -q "\"$ART_NAME\"" "$ART_CONFIG"; then
    echo "error: runtime texture bundle is missing $ART_NAME" >&2
    exit 1
  fi
  ART_COUNT=$((ART_COUNT + 1))
done
if [ "$ART_COUNT" -ne 29 ]; then
  echo "error: expected 29 audited runtime art entries, found $ART_COUNT" >&2
  exit 1
fi
CONFIG_ART_COUNT=$(jq '[.paths[] | select(.[1] == 0)] | length' "$ART_CONFIG")
if [ "$CONFIG_ART_COUNT" -ne 29 ]; then
  echo "error: expected texture config to contain exactly 29 runtime textures, found $CONFIG_ART_COUNT" >&2
  exit 1
fi

DANCER_DIR="$WEB_DIR/assets/dancer"
DANCER_CONFIG="$DANCER_DIR/config.json"
if [ ! -f "$DANCER_CONFIG" ]; then
  echo "error: dancer runtime bundle was not built" >&2
  exit 1
fi
if ! jq -e '.name == "dancer"' "$DANCER_CONFIG" >/dev/null; then
  echo "error: dancer bundle config has the wrong bundle name" >&2
  exit 1
fi
DANCER_CLIP_TYPE=$(jq -r '.types | to_entries[] | select(.value == "cc.SkeletonAnimationClip") | .key' "$DANCER_CONFIG")
DANCER_PREFAB_TYPE=$(jq -r '.types | to_entries[] | select(.value == "cc.Prefab") | .key' "$DANCER_CONFIG")
if [ -z "$DANCER_CLIP_TYPE" ] || [ -z "$DANCER_PREFAB_TYPE" ]; then
  echo "error: dancer bundle must contain a Prefab and SkeletonAnimationClip assets" >&2
  exit 1
fi
if jq -e '.types | index("cc.BufferAsset") != null' "$DANCER_CONFIG" >/dev/null; then
  echo "error: dancer import-only source buffer must not enter the runtime bundle" >&2
  exit 1
fi
DANCER_CLIP_COUNT=$(jq --argjson type "$DANCER_CLIP_TYPE" '[.paths[] | select(.[1] == $type)] | length' "$DANCER_CONFIG")
DANCER_PREFAB_COUNT=$(jq --argjson type "$DANCER_PREFAB_TYPE" '[.paths[] | select(.[1] == $type)] | length' "$DANCER_CONFIG")
if [ "$DANCER_CLIP_COUNT" -ne 7 ] || [ "$DANCER_PREFAB_COUNT" -lt 1 ]; then
  echo "error: dancer bundle expected 1+ Prefab and exactly 7 animation clips" >&2
  exit 1
fi
for ANIMATION_NAME in IdleSway IdleSway0 DanceCombo DanceCombo2 ResultPose ResultPose2 ResultPose3; do
  if ! grep -R -q "\"$ANIMATION_NAME\"" "$DANCER_DIR/import"; then
    echo "error: built dancer import data is missing $ANIMATION_NAME" >&2
    exit 1
  fi
done
node "$PROJECT_ROOT/tools/verify-dancer-assets.mjs" "$DANCER_DIR"
DANCER_BYTES=$(find "$DANCER_DIR" -type f -exec stat -f '%z' {} \; | awk '{ total += $1 } END { print total + 0 }')
DANCER_BUDGET=$((5 * 1024 * 1024))
if [ "$DANCER_BYTES" -gt "$DANCER_BUDGET" ]; then
  echo "error: dancer bundle exceeds the 5 MiB runtime budget ($DANCER_BYTES bytes)" >&2
  exit 1
fi
if find "$WEB_DIR/assets" -type f -exec shasum -a 256 {} + \
  | grep -q '^0ae9d0faba3c3df5a0333880cf82f2a96d7669d082de5a8c38663963d773d7de '; then
  echo "error: dancer import-only source buffer must not enter any built bundle" >&2
  exit 1
fi
if printf '%s\n' "$ZIP_LIST" | grep -Eiq '(^|/)[^/]+\.fbx$|(^|/)[^/]+\.fbm(/|$)|(^|/)Image_0\.png$'; then
  echo "error: original FBX/FBM dancer source material must not enter the build" >&2
  exit 1
fi
if printf '%s\n' "$ZIP_LIST" | grep -Eq '(^|/)design(/|$)|主界面|今日任务|游戏界面|选择歌曲|按键\.psd'; then
  echo "error: design references must not be included in the runtime bundle" >&2
  exit 1
fi
if find "$WEB_DIR/assets" -type f -name 'config.json' -exec grep -Eq '主界面|今日任务|游戏界面|选择歌曲|按键|assets/design' {} +; then
  echo "error: a runtime asset bundle references files from assets/design" >&2
  exit 1
fi

rm -f "$ASSETS_ZIP_PATH"
(cd "$PROJECT_ROOT/assets" && zip -q "$ASSETS_ZIP_PATH" \
  audio/bgm/feng-wu-jiu-tian.mp3 \
  audio/bgm/zhu-zhu-xia.mp3 \
  audio/bgm/are-you-ok.mp3)
ASSETS_ZIP_LIST=$(unzip -Z1 "$ASSETS_ZIP_PATH")
AUDIO_FILE_COUNT=0
for ASSET_ENTRY in $ASSETS_ZIP_LIST; do
  case "$ASSET_ENTRY" in
    audio/bgm/feng-wu-jiu-tian.mp3|audio/bgm/zhu-zhu-xia.mp3|audio/bgm/are-you-ok.mp3)
      AUDIO_FILE_COUNT=$((AUDIO_FILE_COUNT + 1))
      ;;
    *)
      echo "error: unexpected file in Builda assets zip: $ASSET_ENTRY" >&2
      exit 1
      ;;
  esac
done
if [ "$AUDIO_FILE_COUNT" -ne 3 ]; then
  echo "error: expected exactly three audited song tracks in Builda assets zip" >&2
  exit 1
fi

"$PROJECT_ROOT/.builda-agent/builda" bundle-check --webview-compatible "$ZIP_PATH"
"$PROJECT_ROOT/.builda-agent/builda" assets check "$ASSETS_ZIP_PATH"
echo "builda-verify=ok"
echo "runtime-art-count=$CONFIG_ART_COUNT"
echo "dancer-clips=$DANCER_CLIP_COUNT"
echo "dancer-bundle-bytes=$DANCER_BYTES"
echo "bundle=$ZIP_PATH"
echo "assets-audio-files=$AUDIO_FILE_COUNT"
echo "assets-bundle=$ASSETS_ZIP_PATH"
