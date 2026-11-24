#!/usr/bin/env bash
# Usage: FIRMWARE_SIGNING_KEY=<PEM> sign.sh <app.bin>
set -euo pipefail

app=${1:?usage: sign.sh <app.bin>}
if [[ ! -f $app ]]; then
  echo "sign.sh: $app not found" >&2
  exit 1
fi
if [[ -z ${FIRMWARE_SIGNING_KEY:-} ]]; then
  echo "sign.sh: FIRMWARE_SIGNING_KEY is not set" >&2
  exit 1
fi

dir=$(dirname "$app")
umask 077
key=$(mktemp)
trap 'rm -f "$key"' EXIT
printf '%s\n' "$FIRMWARE_SIGNING_KEY" >"$key"

openssl dgst -sha256 -sign "$key" -out "$dir/app.sig" "$app"
openssl dgst -sha256 -r "$app" | cut -d' ' -f1 >"$dir/app.sha256"
