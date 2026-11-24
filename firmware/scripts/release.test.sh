#!/usr/bin/env bash
set -euo pipefail

SCRIPTS_DIR=$(cd "$(dirname "$0")" && pwd)
readonly SCRIPTS_DIR SIGN=$SCRIPTS_DIR/sign.sh VERIFY=$SCRIPTS_DIR/verify-release.sh

failures=0
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

pass() { echo "ok - $1"; }
fail() {
  echo "not ok - $1"
  failures=$((failures + 1))
}
check() {
  local name=$1
  shift
  if "$@"; then pass "$name"; else fail "$name"; fi
}
refuses() {
  local name=$1
  shift
  if "$@" >/dev/null 2>&1; then fail "$name"; else pass "$name"; fi
}

new_key() {
  openssl ecparam -name prime256v1 -genkey -noout -out "$tmp/$1.pem" 2>/dev/null
  openssl ec -in "$tmp/$1.pem" -pubout -out "$tmp/$1.pub.pem" 2>/dev/null
}

make_release() {
  local dir=$1
  mkdir -p "$dir"
  head -c 4096 /dev/urandom >"$dir/app.bin"
  head -c $((0x10000)) /dev/zero >"$dir/factory.bin"
  cat "$dir/app.bin" >>"$dir/factory.bin"
}

new_key good
new_key other
make_release "$tmp/rel"

out=$(FIRMWARE_SIGNING_KEY=$(cat "$tmp/good.pem") "$SIGN" "$tmp/rel/app.bin" 2>&1)
check "sign writes a signature" test -s "$tmp/rel/app.sig"
check "sign writes the sha256" test "$(cat "$tmp/rel/app.sha256")" = "$(openssl dgst -sha256 -r "$tmp/rel/app.bin" | cut -d' ' -f1)"
check "sign never prints the key" test "${out#*PRIVATE KEY}" = "$out"
check "sign leaves no key file behind" test -z "$(find "$tmp/rel" -name '*.pem')"
check "signature is DER" openssl asn1parse -inform DER -in "$tmp/rel/app.sig" -noout

refuses "sign needs the key" env -u FIRMWARE_SIGNING_KEY "$SIGN" "$tmp/rel/app.bin"
refuses "sign needs an existing file" env FIRMWARE_SIGNING_KEY=x "$SIGN" "$tmp/missing.bin"

check "verify accepts a valid release" "$VERIFY" "$tmp/rel" "$tmp/good.pub.pem"
refuses "verify rejects another key" "$VERIFY" "$tmp/rel" "$tmp/other.pub.pem"

cp -r "$tmp/rel" "$tmp/flipped"
printf '\xff' | dd of="$tmp/flipped/app.bin" bs=1 seek=100 conv=notrunc 2>/dev/null
refuses "verify rejects a changed app" "$VERIFY" "$tmp/flipped" "$tmp/good.pub.pem"

cp -r "$tmp/rel" "$tmp/factory"
printf '\xff' | dd of="$tmp/factory/factory.bin" bs=1 seek=$((0x10000 + 10)) conv=notrunc 2>/dev/null
refuses "verify rejects a factory image without the app at 0x10000" "$VERIFY" "$tmp/factory" "$tmp/good.pub.pem"

cp -r "$tmp/rel" "$tmp/short"
head -c $((0x10000 + 100)) "$tmp/rel/factory.bin" >"$tmp/short/factory.bin"
refuses "verify rejects a short factory image" "$VERIFY" "$tmp/short" "$tmp/good.pub.pem"

if ((failures > 0)); then
  echo "$failures failed"
  exit 1
fi
echo "all passed"
