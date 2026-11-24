# Firmware

ESP32-C3 (SuperMini) firmware. PlatformIO with the pioarduino platform
(Arduino core 3.x). Install PlatformIO Core 6 first.

## Build and test

Run from `firmware/`:

```sh
pio test -e native          # unit tests for lib/core on this computer
pio run -e staging          # image for the staging server
pio run -e production       # image for the production server
```

Local builds report version `0.0.0-dev`. Release builds take the version
from the `FW_VERSION` environment variable (`MAJOR.MINOR.PATCH`).

## Flash and monitor

```sh
pio run -e staging -t upload
pio device monitor
```

The first serial line is
`boot fw <version> server <url> ota key <fingerprint>`.

## Local server

Create `platformio_override.ini` (git-ignored) to point a build at your
own API:

```ini
[env:staging]
custom_server_url = http://192.168.1.20:3000
```

## Permanent parts

The bootloader, `partitions.csv` and `keys/ota-signing.pub.pem` stay on
the board for its whole life. Changing them, or bumping the platform
version in `platformio.ini`, needs explicit sign-off in review.

Check the OTA key fingerprint against the boot line:

```sh
openssl pkey -pubin -in keys/ota-signing.pub.pem -outform DER | shasum -a 256 | cut -c1-16
```

## Signing key

The private key is the GitHub secret `FIRMWARE_SIGNING_KEY`, backed up in
a password manager. It never goes into the repo, the server or a
developer machine. Only the public key is committed.

## Release

1. Push a tag `fw-v<MAJOR.MINOR.PATCH>`, for example `fw-v2.0.0`. The
   `Firmware release` workflow builds the staging and production images,
   signs `app.bin` with `FIRMWARE_SIGNING_KEY`, checks each signature
   against `keys/ota-signing.pub.pem` and that `factory.bin` holds
   `app.bin` at `0x10000`. It attaches six assets
   (`elec-fw-<version>-<env>-{app.bin,factory.bin,app.sig}`) to a draft
   GitHub Release.
2. Download them: `gh release download fw-v2.0.0 -D /tmp/fw-2.0.0`.
3. From the repo root, with the environment's `server/.env`:

   ```sh
   npm run firmware:release -w server -- /tmp/fw-2.0.0 --version 2.0.0 --env staging
   npm run firmware:release -w server -- /tmp/fw-2.0.0 --version 2.0.0 --env staging --publish
   ```

   The first command uploads the files and adds a draft release. The second
   publishes it, so the Flash firmware page offers it. Repeat with
   `--env production` and the production `.env`.

`scripts/release.test.sh` tests the signing and verify scripts.
