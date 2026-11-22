# Staging on EC2

Runbook for the staging API and worker described in
[PROJECT_V2.md §12](../docs/PROJECT_V2.md#ec2-staging-setup). Run every
command on `elec-staging` as `ubuntu` unless it says otherwise.

| File                                  | Goes to                                 |
| ------------------------------------- | --------------------------------------- |
| `Caddyfile`                           | `/etc/caddy/Caddyfile`                  |
| `systemd/elec-staging-api.service`    | `/etc/systemd/system/`                  |
| `systemd/elec-staging-worker.service` | `/etc/systemd/system/`                  |
| `staging.env.example`                 | `/etc/elec/staging.env` (filled in)     |
| `staging-release.sh`                  | run from the checkout for every release |

## First setup

1. **Elastic IP and DNS.** In the EC2 console allocate an Elastic IP and
   associate it with `elec-staging`. In Porkbun add an `A` record
   `staging-api` → that IP. From your computer, `dig +short
   staging-api.elec-monitoring.homes A` must print the Elastic IP.
2. **Base system and swap.**

   ```sh
   sudo apt update && sudo apt full-upgrade -y
   sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
   sudo mkswap /swapfile && sudo swapon /swapfile
   echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
   ```

3. **Node.js 26.**

   ```sh
   curl -fsSL https://deb.nodesource.com/setup_26.x | sudo -E bash -
   sudo apt install -y nodejs git
   node -v
   ```

   `node -v` must print `v26.x`, and `which node` must print `/usr/bin/node`.

4. **Caddy.**

   ```sh
   sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
   curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
     | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
   curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
     | sudo tee /etc/apt/sources.list.d/caddy-stable.list
   sudo apt update && sudo apt install -y caddy
   ```

5. **Service user and checkout.**

   ```sh
   sudo useradd --system --no-create-home --shell /usr/sbin/nologin elec
   sudo install -d -o ubuntu -g ubuntu /opt/elec
   git clone --branch v2 https://github.com/<owner>/elec-monitoring.git /opt/elec/staging
   ```

6. **Secrets.** Create the env file empty and locked, then paste
   `staging.env.example` with real values:

   ```sh
   sudo install -d -m 0755 /etc/elec
   sudo install -m 0600 -o root -g root /dev/null /etc/elec/staging.env
   sudoedit /etc/elec/staging.env
   ```

   Generate `JWT_SECRET` with `openssl rand -base64 48`.

7. **Services and Caddy.**

   ```sh
   cd /opt/elec/staging
   sudo cp deploy/systemd/elec-staging-*.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable elec-staging-api elec-staging-worker
   sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
   sudo systemctl reload caddy
   ```

8. **First release:** `deploy/staging-release.sh` (see below).

## Every release

```sh
/opt/elec/staging/deploy/staging-release.sh
```

It pulls `v2`, runs `npm ci` and the build, applies migrations as `elec`
with the staging env, then restarts the API and worker. It stops at the
first failing step, so a failed migration leaves the old services
running. If a migration fails through the transaction pooler, rerun that
step with the Supabase session pooler URL (port `5432`) as
`DATABASE_URL`.

If `deploy/systemd/*` or `deploy/Caddyfile` changed, copy them again
(step 7) before the release.

## Checks

```sh
curl -sS https://staging-api.elec-monitoring.homes/health
journalctl -u elec-staging-api -u elec-staging-worker -n 50 --no-pager
journalctl -u caddy -n 50 --no-pager
```

- `/health` returns `{"status":"ok"}`.
- The API log shows `api listening on 127.0.0.1:3000`; the worker log
  shows `worker started`.
- In the Supabase SQL editor, `select * from worker_heartbeat;` shows
  `beat_at` moving forward about every 10 seconds.
- `curl -m 5 http://<elastic-ip>:3000/health` from your computer fails.
