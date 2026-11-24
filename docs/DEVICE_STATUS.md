# Device status (ESP32-C3 SuperMini)

How to read what the device is doing, without a computer (LEDs) or with
one (serial log).

## Setup mode

The device starts its own Wi-Fi network `ElecMonitor-XXXX` (the last 4
hex digits of its MAC address) when:

- it has no Wi-Fi details or no device token yet (first boot), or
- the BOOT button (GPIO 9) is held for 5 s at any time. The blue LED
  stays on for 1 s, then setup mode starts.

Join the network from a phone. The setup page opens by itself (or go to
`http://192.168.4.1`). Enter the Wi-Fi name, password and the pairing code
from the app. Only 2.4 GHz Wi-Fi works.

- The device tests the Wi-Fi (up to 3 tries) and claims the code before
  saving anything. An error appears under the field it is about: Wi-Fi
  name, password or pairing code.
  A wrong password or a bad code leaves the old settings in place.
- If the device is already paired, leave the code empty to change only
  the Wi-Fi.
- After success the device restarts in 3 s.
- Setup mode entered with the button ends after 10 min without a
  submission, and the device restarts unchanged. On first boot it waits
  until set up.

## LEDs

| LED  | Pin                 | State                       | Meaning                                         |
| ---- | ------------------- | --------------------------- | ----------------------------------------------- |
| Red  | none (3.3 V)        | on                          | Board has power (not controllable)              |
| Red  | none (3.3 V)        | off                         | No power / no USB                               |
| Blue | GPIO 8 (active low) | slow blink (1 Hz)           | Setup mode                                      |
| Blue | GPIO 8 (active low) | fast blink (5 Hz)           | Wi-Fi connecting                                |
| Blue | GPIO 8 (active low) | short flash                 | Check-in delivered (server replied `204`)       |
| Blue | GPIO 8 (active low) | solid on                    | Last check-in failed                            |
| Blue | GPIO 8 (active low) | two short flashes every 2 s | Token rejected (`401`). Set the device up again |
| Blue | GPIO 8 (active low) | solid on for 1 s            | BOOT held 5 s, setup mode starts                |
| Blue | GPIO 8 (active low) | off between flashes         | All good                                        |

## Serial log

`pio device monitor` (115200 baud), from `firmware/`. The log never shows
the device token, the Wi-Fi password or the pairing code.

| Line                                                            | Meaning                                                                                           |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `boot fw 2.0.0 server … reason POWER_ON id b738… ota key 1a2b…` | Boot: firmware version, server, reset reason, boot id, OTA key                                    |
| `wifi connected ip … rssi -61`                                  | Wi-Fi connected                                                                                   |
| `wifi lost reason 201`                                          | Wi-Fi dropped, with the driver reason code                                                        |
| `wifi down for 60 s, reconnecting`                              | No Wi-Fi for 60 s, forcing a reconnect                                                            |
| `time synced` / `time not synced`                               | Clock set over SNTP, or gave up after 30 s and continues anyway                                   |
| `BOOT -> 204`                                                   | First check-in of this boot delivered                                                             |
| `BOOT -> -1, retry in 4 s`                                      | Couldn't reach the server, retrying with backoff (up to 60 s)                                     |
| `PING -> 204 (seq 42, events 2)`                                | Ping delivered with 2 Wi-Fi diagnostic records                                                    |
| `PING -> 429, retry in 30 s`                                    | Rate limited, waiting for `Retry-After`                                                           |
| `PING -> 401, re-pair the device`                               | Token rejected (rotated or device deleted). Check-ins every 5 min                                 |
| `setup mode ElecMonitor-3F2A (button\|no config)`               | Setup mode started and why                                                                        |
| `setup wifi retry (reason 15)`                                  | Setup Wi-Fi attempt failed, trying again (up to 3 tries, 2 for network not found)                 |
| `setup wifi -> WIFI_AUTH_FAILED (reason 15)`                    | Setup Wi-Fi test result after the retries (`WIFI_NOT_FOUND`, `WIFI_FAILED`), with the last reason |
| `setup wifi -> CLAIMING`                                        | Wi-Fi works, claiming the pairing code                                                            |
| `claim -> 404`                                                  | Pairing code claim result (`200` ok, `404` unknown, `410` expired)                                |
| `setup done, restarting`                                        | Settings saved, restarting in 3 s                                                                 |
| `setup timed out, restarting`                                   | Button setup mode ended after 10 min without a submission                                         |
| `heap free … min …`                                             | Free heap every 10 min. `min` should stay steady                                                  |
| `E (…) wifi:…`                                                  | Wi-Fi driver message, harmless if check-ins still get `204`                                       |

Negative statuses are network errors: `-1` can't connect (server down,
TLS failed), `-11` no answer within 10 s.

Common Wi-Fi reason codes: `2` auth expired, `8` left on purpose, `15`
handshake timeout (often a wrong password), `201` network not found, `202`
auth failed, `204` handshake timeout.

`rssi` is signal strength in dBm: above -60 is good, below -80 is weak.
