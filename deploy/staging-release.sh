#!/usr/bin/env bash
set -euo pipefail

cd /opt/elec/staging
git pull --ff-only origin v2
npm ci
npm run build

sudo systemd-run --wait --pipe --collect --uid=elec --gid=elec \
  --property=WorkingDirectory=/opt/elec/staging/server \
  --property=EnvironmentFile=/etc/elec/staging.env \
  /usr/bin/node dist/db/migrate.js

sudo systemctl restart elec-staging-api elec-staging-worker
systemctl --no-pager --lines=5 status elec-staging-api elec-staging-worker
