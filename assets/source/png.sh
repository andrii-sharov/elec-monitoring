#!/bin/sh
# Usage: png.sh <svg> <png> <width> <height>
set -eu
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
svg="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
page="$(mktemp "${TMPDIR:-/tmp}/pngXXXXXX").html"
printf '<html><body style="margin:0"><img src="file://%s" width="%s" height="%s" style="display:block"></body></html>' \
  "$svg" "$3" "$4" > "$page"
"$CHROME" ${CHROME_FLAGS:-} --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
  --default-background-color=00000000 --window-size="$3,$4" \
  --screenshot="$2" "file://$page" 2>/dev/null
rm -f "$page"
