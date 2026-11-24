# Staging on EC2

Runbook for the staging API and worker described in
[PROJECT_V2.md §12](../docs/PROJECT_V2.md#ec2-staging-setup). Run every
command on `elec-staging` as `ubuntu` unless it says otherwise.

| File                                               | Goes to                                |
| -------------------------------------------------- | -------------------------------------- |
| `Caddyfile`                                        | `/etc/caddy/Caddyfile`                 |
| `systemd/elec-staging-api.service`                 | `/etc/systemd/system/`                 |
| `systemd/elec-staging-worker.service`              | `/etc/systemd/system/`                 |
| `systemd/elec-staging-auto-deploy.{service,timer}` | `/etc/systemd/system/`                 |
| `staging.env.example`                              | `/etc/elec/staging.env` (filled in)    |
| `staging-release.sh`                               | runs a release from the checkout       |
| `staging-auto-deploy.sh`                           | polls GitHub from the checkout         |
| `staging-release.test.sh`                          | CI only: tests both scripts with stubs |

## Layout on the instance

| Path                                      | What                                                 |
| ----------------------------------------- | ---------------------------------------------------- |
| `/opt/elec/staging`                       | `v2` checkout; the release script runs from here     |
| `/opt/elec/staging-releases/<time>-<sha>` | one built release each; the last 3 are kept          |
| `/opt/elec/staging-current`               | symlink to the running release; services use it      |
| `/opt/elec/staging-current/REVISION`      | the deployed commit SHA                              |
| `/opt/elec/staging-release.lock`          | release lock shared by automatic and manual releases |

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
   sudo install -m 0644 deploy/systemd/elec-staging-{api,worker}.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable elec-staging-api elec-staging-worker
   sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
   sudo systemctl reload caddy
   ```

8. **First release:** `deploy/staging-release.sh` (see below). The
   services start from `/opt/elec/staging-current`, which the first
   release creates.

## Every release

A push to `v2` deploys automatically once CI passes (see
[Continuous deployment](#continuous-deployment)). To release by hand
over SSH:

```sh
/opt/elec/staging/deploy/staging-release.sh
```

Both paths run the same script under the same lock, so releases never
overlap; a second release waits up to 10 minutes for the first. The
script:

1. fetches `origin/v2` and picks its tip. With `--sha <commit>` (the
   automatic path) it exits with code `3` ("skipped") if the commit
   has already been deployed or is no longer the tip;
2. fast-forwards the checkout to that commit;
3. exports the commit into a new directory under
   `/opt/elec/staging-releases/` and runs `npm ci` and `npm run build`
   there;
4. applies migrations from the new build as `elec` with
   `/etc/elec/staging.env`;
5. points `/opt/elec/staging-current` at the new build and restarts the
   API and worker;
6. checks that both services are active.

A failure in steps 1–4 stops before the switch: the running release
stays untouched and the failed build directory is removed. The script
prints `release failed at step: <step>` on any failure.

The script runs from the checkout, which it fast-forwards during the
release, so a change to `staging-release.sh` takes effect from the
release after the one that ships it.

If the API, worker, or Caddy configuration changes, install the updated
files as in step 7 and restart the corresponding services. If the timer
or its service changes, reinstall those units using the commands below
and restart the timer.

### Roll back by hand

Migrations are not rolled back, so this only works while the schema is
compatible with the old build (P §12 requires that). Pause autodeploy
and wait until the auto-deploy service finishes before switching:

```sh
sudo systemctl disable --now elec-staging-auto-deploy.timer
systemctl is-active elec-staging-auto-deploy.service
ls /opt/elec/staging-releases
ln -sfn /opt/elec/staging-releases/<previous> /opt/elec/staging-current
sudo systemctl restart elec-staging-api elec-staging-worker
```

Leave the timer paused until the tip of `v2` is ready to deploy again.
When ready, run `sudo systemctl enable --now elec-staging-auto-deploy.timer`.

## Continuous deployment

Every 15 minutes the timer reads the tip of `v2` from GitHub and
checks the latest `CI` push run for that exact commit. It skips the
deployed SHA and waits for a successful run before starting a release.
The release script rechecks the tip under the release lock. If a
release fails (build, migration, restart or service check), the timer
writes that SHA to `/opt/elec/staging-failed-sha` and does not retry it,
so a broken release doesn't rebuild and rerun migrations every tick. The
next push to `v2` deploys normally. To retry the same commit, fix the
cause and run `rm /opt/elec/staging-failed-sha`, or release by hand. On success
the timer checks the public HTTPS endpoint for HTTP 200 and
`{"status":"ok"}`. Logs go to the systemd journal. A failed public health
check is logged and requires investigation. Manual rollback is described
above.

The instance uses outbound HTTPS for the public GitHub repository and
Actions API. Its timer runs as `ubuntu`, using that user's existing
passwordless sudo for migration and service restarts.

### Enable on the existing staging instance

After pushing these files to `v2` and seeing a green CI run, connect to
`elec-staging` over SSH. If your API and worker already use
`/opt/elec/staging-current`, go directly to the timer installation after
pulling the latest code. For an installation that still runs from
`/opt/elec/staging/server`, create the first versioned release and install
the updated API and worker units now:

```sh
cd /opt/elec/staging &&
git pull --ff-only origin v2 &&
sudo -n true &&
./deploy/staging-release.sh &&
sudo install -m 0644 deploy/systemd/elec-staging-{api,worker}.service /etc/systemd/system/ &&
sudo systemctl daemon-reload &&
sudo systemctl restart elec-staging-api elec-staging-worker &&
curl -fsS --retry 6 --retry-delay 2 --max-time 8 https://staging-api.elec-monitoring.homes/health
```

Once the endpoint returns `{"status":"ok"}`, install the timer:

```sh
cd /opt/elec/staging &&
sudo -n true &&
sudo install -m 0644 deploy/systemd/elec-staging-auto-deploy.{service,timer} /etc/systemd/system/ &&
sudo systemctl daemon-reload &&
sudo systemctl enable --now elec-staging-auto-deploy.timer &&
systemctl list-timers elec-staging-auto-deploy.timer
```

On the next green push to `v2`, check the journal and confirm that
`REVISION` contains the pushed commit:

```sh
sudo journalctl -u elec-staging-auto-deploy.service -n 50 --no-pager
cat /opt/elec/staging-current/REVISION
curl -fsS https://staging-api.elec-monitoring.homes/health
```

## Checks

```sh
cat /opt/elec/staging-current/REVISION
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

# Client app on Vercel

Set up by hand once; Vercel then builds every push. The client lives in
`client/` and depends on the `shared/` workspace. The staging API already
allows `CLIENT_URL=https://staging-app.elec-monitoring.homes`.

1. **Import.** In Vercel choose Add New > Project and import the GitHub
   repository.
2. **Settings.**
   - Root Directory: `client`. Enable "Include source files outside of the
     Root Directory in the Build Step", because `shared/` is a workspace
     dependency.
   - Framework Preset: Vite.
   - Build Command: `npm run build`. Output Directory: `dist`.
   - Install Command: leave the default; with the files outside the root
     included, Vercel installs from the repo root workspace.
   - Node.js Version: 26 if Vercel offers it, otherwise the newest it
     offers. The root `package.json` has `engines.node >= 26`, so on an
     older Node the install may warn or fail. If it fails, wait until
     Vercel offers Node 26 and redeploy; do not lower `engines`.
3. **Environment variable.** Add `VITE_API_URL` =
   `https://staging-api.elec-monitoring.homes` for the Preview environment
   and for the `v2` branch (Production Branch stays `main`; add the
   variable as a Preview variable scoped to the `v2` branch too).
4. **Domain.** In Domains add `staging-app.elec-monitoring.homes` and
   assign it to the `v2` Git branch.
5. **DNS.** Vercel shows the `CNAME` target for that domain. In Porkbun
   add a `CNAME` record `staging-app` pointing to that value. Wait until
   Vercel shows the domain as valid.
6. **Check.** Open `https://staging-app.elec-monitoring.homes/login`, then
   reload a deep link such as `/account`: it must load the app, not a 404.

Preview `*.vercel.app` URLs can't sign in: the API's CORS and the refresh
cookie allow only the stable origins. Test sign-in on
`staging-app.elec-monitoring.homes`.
