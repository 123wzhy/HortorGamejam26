#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
WEB_DIR="$PROJECT_ROOT/build/web-mobile"
ZIP_PATH="$PROJECT_ROOT/build/builda-web.zip"

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

ART_CONFIG="$WEB_DIR/assets/texture/config.json"
if [ ! -f "$ART_CONFIG" ]; then
  echo "error: runtime texture bundle was not built" >&2
  exit 1
fi
for ART_NAME in BackGround logo startBtn settingBtn rankBtn helpBtn leftArrow downArrow upArrow rightArrow leftArrow2 downArrow2 upArrow2 rightArrow2; do
  if ! grep -q "\"$ART_NAME\"" "$ART_CONFIG"; then
    echo "error: runtime texture bundle is missing $ART_NAME" >&2
    exit 1
  fi
done
if printf '%s\n' "$ZIP_LIST" | grep -Eq '(^|/)design(/|$)|主界面|今日任务|游戏界面|选择歌曲|按键\.psd'; then
  echo "error: design references must not be included in the runtime bundle" >&2
  exit 1
fi
if find "$WEB_DIR/assets" -type f -name 'config.json' -exec grep -Eq '主界面|今日任务|游戏界面|选择歌曲|按键|assets/design' {} +; then
  echo "error: a runtime asset bundle references files from assets/design" >&2
  exit 1
fi

"$PROJECT_ROOT/.builda-agent/builda" bundle-check --webview-compatible "$ZIP_PATH"
echo "builda-verify=ok"
echo "bundle=$ZIP_PATH"
