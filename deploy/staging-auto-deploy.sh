#!/usr/bin/env bash
set -euo pipefail

readonly root=${ELEC_ROOT:-/opt/elec}
readonly checkout=$root/staging
readonly revision=$root/staging-current/REVISION
readonly failed=$root/staging-failed-sha
readonly ci_url=https://api.github.com/repos/andrii-sharov/elec-monitoring/actions/workflows/ci.yml/runs
readonly health_url=https://staging-api.elec-monitoring.homes/health

main() {
  tip=$(git -C "$checkout" ls-remote --exit-code origin refs/heads/v2)
  sha=${tip%%$'\t'*}
  if [[ ! $sha =~ ^[0-9a-f]{40}$ ]]; then
    echo 'Could not read a valid origin/v2 commit SHA' >&2
    exit 1
  fi

  if [[ -r $revision && $(<"$revision") == "$sha" ]]; then
    exit 0
  fi
  if [[ -r $failed && $(<"$failed") == "$sha" ]]; then
    echo "Staging $sha: release failed before, waiting for a new push (delete $failed to retry)"
    exit 0
  fi

  runs=$(curl -fsS --max-time 15 -H 'Accept: application/vnd.github+json' \
    "$ci_url?branch=v2&event=push&head_sha=$sha&per_page=1")
  ci_result=$(node -e '
    const { workflow_runs: runs } = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
    if (!Array.isArray(runs)) throw new Error("GitHub response has no workflow_runs array");
    const run = runs[0];
    if (run?.head_sha === process.argv[1] && run.head_branch === "v2" && run.event === "push") {
      console.log(run.status === "completed" ? run.conclusion : run.status);
    } else {
      console.log("no matching CI run");
    }
  ' "$sha" <<<"$runs")

  if [[ $ci_result != success ]]; then
    echo "Staging $sha: waiting for successful CI ($ci_result)"
    exit 0
  fi

  echo "Staging $sha: CI passed, starting release"
  release_status=0
  "$checkout/deploy/staging-release.sh" --sha "$sha" || release_status=$?
  case $release_status in
    0) ;;
    3) exit 0 ;;
    *)
      echo "$sha" >"$failed"
      exit "$release_status"
      ;;
  esac

  deadline=$((SECONDS + 120))
  until curl -fsS --max-time 5 --write-out '\n%{http_code}' "$health_url" | node -e '
    const response = require("node:fs").readFileSync(0, "utf8");
    const separator = response.lastIndexOf("\n");
    const status = response.slice(separator + 1);
    const body = response.slice(0, separator);
    try { process.exit(status === "200" && JSON.parse(body).status === "ok" ? 0 : 1); }
    catch { process.exit(1); }
  '; do
    if ((SECONDS >= deadline)); then
      echo "Staging $sha: public health check failed" >&2
      exit 1
    fi
    sleep 5
  done
  echo "Staging $sha: deployed and healthy"
}

main
