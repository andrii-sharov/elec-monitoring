#include <Arduino.h>
#include <HTTPClient.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <esp_task_wdt.h>

#include "root_ca.h"
#include "secrets.h"

static const uint32_t PING_INTERVAL_MS = 30 * 1000;
static const uint32_t HTTP_TIMEOUT_MS = 10 * 1000;
static const uint32_t RECONNECT_INTERVAL_MS = 10 * 1000;
static const uint32_t WATCHDOG_TIMEOUT_S = 60;

static uint32_t lastPingAt = 0;
static uint32_t lastReconnectAt = 0;
static bool pingedOnce = false;

static void startWatchdog() {
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  esp_task_wdt_config_t config = {
      .timeout_ms = WATCHDOG_TIMEOUT_S * 1000,
      .idle_core_mask = 0,
      .trigger_panic = true,
  };
  esp_task_wdt_reconfigure(&config);
#else
  esp_task_wdt_init(WATCHDOG_TIMEOUT_S, true);
#endif
  esp_task_wdt_add(NULL);
}

static void connectWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
}

static void keepWiFiAlive() {
  if (WiFi.status() == WL_CONNECTED) return;
  if (millis() - lastReconnectAt < RECONNECT_INTERVAL_MS) return;
  lastReconnectAt = millis();
  Serial.println("Wi-Fi down, reconnecting");
  WiFi.disconnect();
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
}

static int postPing(WiFiClient &client) {
  HTTPClient http;
  http.setTimeout(HTTP_TIMEOUT_MS);
  http.setConnectTimeout(HTTP_TIMEOUT_MS);
  if (!http.begin(client, String(SERVER_URL) + "/ping")) return -1;
  http.addHeader("Authorization", String("Bearer ") + DEVICE_TOKEN);
  http.addHeader("Content-Type", "application/json");
  int status = http.POST(String("{\"uptime_s\":") + (millis() / 1000) + "}");
  http.end();
  return status;
}

static void sendPing() {
  int status;
  if (strncmp(SERVER_URL, "https://", 8) == 0) {
    WiFiClientSecure client;
    client.setCACert(ROOT_CA);
    status = postPing(client);
  } else {
    WiFiClient client;
    status = postPing(client);
  }
  Serial.printf("ping -> %d\n", status);
}

void setup() {
  Serial.begin(115200);
  startWatchdog();
  connectWiFi();
  configTime(0, 0, "pool.ntp.org", "time.google.com");
}

void loop() {
  esp_task_wdt_reset();
  keepWiFiAlive();

  bool due = !pingedOnce || millis() - lastPingAt >= PING_INTERVAL_MS;
  if (WiFi.status() == WL_CONNECTED && due) {
    lastPingAt = millis();
    pingedOnce = true;
    sendPing();
  }

  delay(100);
}
