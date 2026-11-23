#!/usr/bin/env bash
# shellcheck disable=SC2016
set -euo pipefail

DEPLOY_DIR=$(cd "$(dirname "$0")" && pwd)
readonly DEPLOY_DIR SCRIPT=$DEPLOY_DIR/staging-release.sh AUTO=$DEPLOY_DIR/staging-auto-deploy.sh

for dir in /opt/homebrew/opt/{coreutils,findutils}/libexec/gnubin /opt/homebrew/opt/util-linux/bin; do
  if [[ -d $dir ]]; then PATH=$dir:$PATH; fi
done

failures=0
tmp=

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

write_stub() {
  printf '#!/usr/bin/env bash\n%s\n' "$2" >"$tmp/bin/$1"
  chmod +x "$tmp/bin/$1"
}

setup() {
  tmp=$(mktemp -d)
  mkdir -p "$tmp/bin" "$tmp/root"
  export ELEC_ROOT=$tmp/root ELEC_RELEASE_LOCK=$tmp/release.lock CALLS=$tmp/calls
  : >"$CALLS"

  write_stub sudo 'exec "$@"'
  write_stub sleep ':'
  write_stub date 'n=$(( $(cat "$CALLS.date" 2>/dev/null || echo 0) + 1 )); echo "$n" >"$CALLS.date"; printf "20260101T%06dZ\n" "$n"'
  write_stub npm 'echo "npm $*" >>"$CALLS"; [[ $1 != ci || -z ${FAIL_BUILD:-} ]]'
  write_stub systemd-run 'echo "migrate $*" >>"$CALLS"; [[ -z ${FAIL_MIGRATE:-} ]]'
  write_stub systemctl 'echo "systemctl $*" >>"$CALLS"; if [[ $1 == is-active ]]; then shift; printf "active\n%.0s" "$@"; fi'

  git init -q --bare -b v2 "$tmp/origin.git"
  git clone -q "$tmp/origin.git" "$tmp/work" 2>/dev/null
  git -C "$tmp/work" switch -q -c v2
  push_commit one
  git clone -q -b v2 "$tmp/origin.git" "$ELEC_ROOT/staging"
}

teardown() { rm -rf "$tmp"; }

push_commit() {
  echo "$1" >"$tmp/work/file.txt"
  git -C "$tmp/work" add file.txt
  git -C "$tmp/work" -c user.name=John -c user.email=john@example.com commit -q -m "$1"
  git -C "$tmp/work" push -q origin v2
}

tip() { git -C "$tmp/work" rev-parse HEAD; }
current_revision() { cat "$ELEC_ROOT/staging-current/REVISION" 2>/dev/null || echo none; }
release_count() { find "$ELEC_ROOT/staging-releases" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' '; }

run() {
  set +e
  PATH=$tmp/bin:$PATH "$SCRIPT" "$@" >"$tmp/out" 2>"$tmp/err"
  status=$?
  set -e
}

test_manual_deploys_tip() {
  setup
  run
  check "manual run exits 0" test "$status" -eq 0
  check "manual run switches to the tip" test "$(current_revision)" = "$(tip)"
  check "migrations run in the candidate" grep -q "WorkingDirectory=$ELEC_ROOT/staging-releases/[^ ]*/server " "$CALLS"
  check "both services restart" grep -q "systemctl restart elec-staging-api elec-staging-worker" "$CALLS"
  check "checkout fast-forwards" test "$(git -C "$ELEC_ROOT/staging" rev-parse HEAD)" = "$(tip)"
  teardown
}

test_sha_at_tip_deploys() {
  setup
  run --sha "$(tip)"
  check "--sha at tip exits 0" test "$status" -eq 0
  check "--sha at tip deploys it" test "$(current_revision)" = "$(tip)"
  : >"$CALLS"
  run --sha "$(tip)"
  check "already deployed --sha exits 3" test "$status" -eq 3
  check "already deployed --sha builds nothing" test ! -s "$CALLS"
  teardown
}

test_stale_sha_is_skipped() {
  setup
  local old
  old=$(tip)
  push_commit two
  run --sha "$old"
  check "stale --sha exits 3" test "$status" -eq 3
  check "stale --sha reports skipped" grep -q "skipped" "$tmp/out"
  check "stale --sha builds nothing" test ! -s "$CALLS"
  check "stale --sha leaves no current" test "$(current_revision)" = none
  teardown
}

test_build_failure_keeps_current() {
  setup
  run
  local deployed
  deployed=$(current_revision)
  push_commit two
  FAIL_BUILD=1 run
  check "failed build exits 1" test "$status" -eq 1
  check "failed build names the step" grep -q "release failed at step: build" "$tmp/err"
  check "failed build keeps the current release" test "$(current_revision)" = "$deployed"
  check "failed build removes the candidate" test "$(release_count)" -eq 1
  check "failed build skips migrations" test "$(grep -c '^migrate' "$CALLS")" -eq 1
  teardown
}

test_migration_failure_keeps_current() {
  setup
  run
  local deployed
  deployed=$(current_revision)
  push_commit two
  FAIL_MIGRATE=1 run
  check "failed migration exits 1" test "$status" -eq 1
  check "failed migration names the step" grep -q "release failed at step: migrate" "$tmp/err"
  check "failed migration keeps the current release" test "$(current_revision)" = "$deployed"
  check "failed migration restarts nothing" test "$(grep -c 'systemctl restart' "$CALLS")" -eq 1
  teardown
}

test_old_releases_are_pruned() {
  setup
  for n in two three four five; do
    run
    push_commit "$n"
  done
  run
  check "keeps three releases" test "$(release_count)" -eq 3
  check "latest release is current" test "$(current_revision)" = "$(tip)"
  teardown
}

test_invalid_sha_is_rejected() {
  setup
  run --sha 'abc;reboot'
  check "invalid --sha exits 2" test "$status" -eq 2
  run --sha
  check "missing --sha value exits 2" test "$status" -eq 2
  teardown
}

setup_auto() {
  setup
  write_stub curl 'for arg; do url=$arg; done
if [[ $url == *actions* ]]; then
  sha=${url##*head_sha=}; sha=${sha%%&*}
  printf "{\"workflow_runs\":[{\"head_sha\":\"%s\",\"head_branch\":\"v2\",\"event\":\"push\",\"status\":\"completed\",\"conclusion\":\"%s\"}]}" "$sha" "${CI_CONCLUSION:-success}"
else
  printf "{\"status\":\"ok\"}\n200"
fi'
  mkdir -p "$ELEC_ROOT/staging/deploy" "$ELEC_ROOT/staging-current"
  printf '#!/usr/bin/env bash\necho "release $*" >>"$CALLS"\n[[ -z ${FAIL_RELEASE:-} ]] || exit 1\necho "$2" >"$ELEC_ROOT/staging-current/REVISION"\n' \
    >"$ELEC_ROOT/staging/deploy/staging-release.sh"
  chmod +x "$ELEC_ROOT/staging/deploy/staging-release.sh"
}

run_auto() {
  set +e
  PATH=$tmp/bin:$PATH bash "$AUTO" >"$tmp/out" 2>"$tmp/err"
  status=$?
  set -e
}

release_calls() { grep -c '^release' "$CALLS" || true; }

test_auto_waits_for_ci() {
  setup_auto
  CI_CONCLUSION=failure run_auto
  check "auto: failed CI exits 0" test "$status" -eq 0
  check "auto: failed CI starts no release" test "$(release_calls)" -eq 0
  teardown
}

test_auto_deploys_after_ci() {
  setup_auto
  run_auto
  check "auto: green CI exits 0" test "$status" -eq 0
  check "auto: green CI releases the tip" grep -q "release --sha $(tip)" "$CALLS"
  check "auto: reports healthy" grep -q "deployed and healthy" "$tmp/out"
  run_auto
  check "auto: deployed tip is not released again" test "$(release_calls)" -eq 1
  teardown
}

test_auto_does_not_retry_failed_release() {
  setup_auto
  FAIL_RELEASE=1 run_auto
  check "auto: failed release exits 1" test "$status" -eq 1
  check "auto: failed release records the SHA" test "$(cat "$ELEC_ROOT/staging-failed-sha")" = "$(tip)"
  FAIL_RELEASE=1 run_auto
  check "auto: failed SHA is not retried" test "$(release_calls)" -eq 1
  push_commit two
  run_auto
  check "auto: a new push is released" test "$(release_calls)" -eq 2
  check "auto: the new push is deployed" test "$(current_revision)" = "$(tip)"
  teardown
}

test_manual_deploys_tip
test_sha_at_tip_deploys
test_stale_sha_is_skipped
test_build_failure_keeps_current
test_migration_failure_keeps_current
test_old_releases_are_pruned
test_invalid_sha_is_rejected
test_auto_waits_for_ci
test_auto_deploys_after_ci
test_auto_does_not_retry_failed_release

if ((failures)); then
  echo "$failures check(s) failed"
  exit 1
fi
echo "all checks passed"
