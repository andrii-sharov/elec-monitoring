#!/usr/bin/env bash
# Usage: verify-release.sh <dir with app.bin, app.sig, factory.bin> <public key PEM>
set -euo pipefail

dir=${1:?usage: verify-release.sh <dir> <public key>}
pub=${2:?usage: verify-release.sh <dir> <public key>}
readonly app_offset=$((0x10000))

if ! openssl dgst -sha256 -verify "$pub" -signature "$dir/app.sig" "$dir/app.bin" >/dev/null; then
  echo "verify-release.sh: signature does not match $pub" >&2
  exit 1
fi

app_size=$(wc -c <"$dir/app.bin")
factory_size=$(wc -c <"$dir/factory.bin")
if ((factory_size < app_offset + app_size)); then
  echo "verify-release.sh: factory.bin is shorter than the app at 0x10000" >&2
  exit 1
fi
if ! tail -c +$((app_offset + 1)) "$dir/factory.bin" | head -c "$app_size" | cmp -s - "$dir/app.bin"; then
  echo "verify-release.sh: factory.bin does not hold app.bin at 0x10000" >&2
  exit 1
fi
echo "verified $dir"
