#!/usr/bin/env bash
# Usage: staging-release.sh [--sha <40-char commit>]
# Without --sha it deploys the tip of origin/v2 (manual path over SSH).
# With --sha it exits 3 if the commit is already deployed or no longer the tip.
set -Eeuo pipefail

readonly ROOT=${ELEC_ROOT:-/opt/elec}
readonly REPO=$ROOT/staging
readonly RELEASES=$ROOT/staging-releases
readonly CURRENT=$ROOT/staging-current
readonly ENV_FILE=/etc/elec/staging.env
readonly LOCK=${ELEC_RELEASE_LOCK:-$ROOT/staging-release.lock}
readonly SERVICES=(elec-staging-api elec-staging-worker)
readonly KEEP_RELEASES=3
readonly EXIT_SKIPPED=3

step=start
candidate=

on_error() {
  echo "release failed at step: $step" >&2
  if [[ -n $candidate && $(readlink -f "$CURRENT" 2>/dev/null) != "$candidate" ]]; then
    rm -rf "$candidate"
  fi
  exit 1
}

begin() {
  step=$1
  echo "==> $step"
}

prune_releases() {
  local active
  active=$(readlink -f "$CURRENT" 2>/dev/null || true)
  find "$RELEASES" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' |
    sort -r |
    tail -n +$((KEEP_RELEASES + 1)) |
    while read -r name; do
      [[ $RELEASES/$name == "$active" ]] || rm -rf "${RELEASES:?}/$name"
    done
}

main() {
  trap on_error ERR
  local requested=

  while (($#)); do
    case $1 in
      --sha)
        (($# >= 2)) || { echo "--sha needs a value" >&2; exit 2; }
        requested=$2
        shift 2
        ;;
      *)
        echo "unknown argument: $1" >&2
        exit 2
        ;;
    esac
  done
  if [[ -n $requested && ! $requested =~ ^[0-9a-f]{40}$ ]]; then
    echo "--sha must be a full 40-character lowercase commit SHA" >&2
    exit 2
  fi
  if [[ $(id -un) == root ]]; then
    echo "run as ubuntu, not root" >&2
    exit 2
  fi

  begin lock
  exec 9>>"$LOCK"
  if ! flock -n 9; then
    echo "another release is running, waiting up to 10 minutes"
    flock -w 600 9
  fi

  begin fetch
  git -C "$REPO" fetch --quiet origin +refs/heads/v2:refs/remotes/origin/v2
  local tip
  tip=$(git -C "$REPO" rev-parse refs/remotes/origin/v2)
  if [[ -n $requested && $requested != "$tip" ]]; then
    echo "skipped: $requested is no longer the tip of v2 ($tip)"
    exit "$EXIT_SKIPPED"
  fi
  local sha=$tip
  if [[ -n $requested && -r $CURRENT/REVISION && $(<"$CURRENT/REVISION") == "$sha" ]]; then
    echo "skipped: $sha is already deployed"
    exit "$EXIT_SKIPPED"
  fi
  echo "deploying $sha"

  begin "update checkout"
  if [[ $(git -C "$REPO" symbolic-ref --short -q HEAD) != v2 ]]; then
    echo "$REPO must be on branch v2" >&2
    false
  fi
  git -C "$REPO" merge --ff-only --quiet "$sha"

  begin build
  mkdir -p "$RELEASES"
  candidate=$RELEASES/$(date -u +%Y%m%dT%H%M%SZ)-${sha:0:12}
  mkdir "$candidate"
  git -C "$REPO" archive "$sha" | tar -x -C "$candidate"
  echo "$sha" >"$candidate/REVISION"
  cd "$candidate"
  npm ci --no-audit --no-fund --loglevel=error
  npm run build --silent

  begin migrate
  sudo systemd-run --wait --pipe --collect --quiet --uid=elec --gid=elec \
    --property=WorkingDirectory="$candidate/server" \
    --property=EnvironmentFile="$ENV_FILE" \
    /usr/bin/node dist/db/migrate.js

  begin switch
  ln -sfn "$candidate" "$CURRENT.new"
  mv -T "$CURRENT.new" "$CURRENT"

  begin restart
  sudo systemctl restart "${SERVICES[@]}"

  begin "verify services"
  sleep 5
  systemctl is-active "${SERVICES[@]}"

  candidate=
  prune_releases
  echo "deployed $sha"
}

main "$@"
