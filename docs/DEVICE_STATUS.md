# Device status (ESP32-C3 SuperMini)

How to read what the device is doing, without a computer (LEDs) or with
one (serial log).

## LEDs

| LED  | Pin                 | State               | Meaning                                   |
| ---- | ------------------- | ------------------- | ----------------------------------------- |
| Red  | none (3.3 V)        | on                  | Board has power (not controllable)        |
| Red  | none (3.3 V)        | off                 | No power / no USB                         |
| Blue | GPIO 8 (active low) | fast blink (5 Hz)   | Wi-Fi connecting                          |
| Blue | GPIO 8 (active low) | short flash /30 s   | Ping delivered (server replied 204)       |
| Blue | GPIO 8 (active low) | solid on            | Last ping failed (server down, bad token) |
| Blue | GPIO 8 (active low) | off between flashes | All good                                  |

## Serial log

`pio device monitor` (115200 baud), from `firmware/`.

| Line                                  | Meaning                                                                    |
| ------------------------------------- | -------------------------------------------------------------------------- |
| `ping -> 204 (ip …, rssi …)`          | Ping delivered                                                             |
| `ping -> 401`                         | Wrong `DEVICE_TOKEN` (must match the server env)                           |
| `ping -> -1`                          | Can't reach the server (wrong `SERVER_URL`, server down, HTTPS/TLS failed) |
| `ping -> -11`                         | Server didn't answer within 10 s                                           |
| `Wi-Fi down (status N), reconnecting` | No Wi-Fi for 60 s, forcing a reconnect                                     |
| `E (…) wifi:…`                        | Wi-Fi driver message; harmless if pings still get 204                      |

Wi-Fi status codes: `1` network not found, `4` wrong password /
connect failed, `5` connection lost, `6` disconnected.

`rssi` is signal strength in dBm: above -60 is good, below -80 is weak.
