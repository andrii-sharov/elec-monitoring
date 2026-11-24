#include "api.h"

#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <NetworkClientSecure.h>

#include "backoff.h"

extern const char isrgRootsPem[] asm("_binary_certs_isrg_roots_pem_start");

namespace api {
namespace {
constexpr int32_t kTimeoutMs = 10000;
constexpr unsigned long kHandshakeTimeoutS = 10;

NetworkClientSecure secureClient;
NetworkClient plainClient;

struct RawResponse {
  int status;
  std::optional<uint32_t> retryAfterS;
  std::string body;
};

RawResponse post(const char* path, const std::string& json, const std::string& token) {
  String url = String(SERVER_URL) + path;
  HTTPClient http;
  http.setReuse(false);
  http.setConnectTimeout(kTimeoutMs);
  http.setTimeout(kTimeoutMs);

  bool started;
  if (url.startsWith("https://")) {
    secureClient.setCACert(isrgRootsPem);
    secureClient.setHandshakeTimeout(kHandshakeTimeoutS);
    started = http.begin(secureClient, url);
  } else {
    started = http.begin(plainClient, url);
  }
  if (!started) return {-1, std::nullopt, {}};

  const char* headers[] = {"Retry-After"};
  http.collectHeaders(headers, 1);
  http.addHeader("Content-Type", "application/json");
  if (!token.empty()) http.addHeader("Authorization", String("Bearer ") + token.c_str());

  int status = http.POST(reinterpret_cast<uint8_t*>(const_cast<char*>(json.data())), json.size());
  RawResponse response{status, parseRetryAfter(http.header("Retry-After").c_str()), {}};
  if (status == 200) response.body = http.getString().c_str();
  http.end();
  return response;
}
}  // namespace

Response postCheckIn(const std::string& json, const std::string& token) {
  RawResponse raw = post("/api/v1/device/ping", json, token);
  return {raw.status, raw.retryAfterS};
}

ClaimResponse claim(const std::string& pairingCode) {
  JsonDocument doc;
  doc["pairing_code"] = pairingCode;
  doc["fw"] = FW_VERSION;
  std::string body;
  serializeJson(doc, body);
  RawResponse raw = post("/api/v1/device/claim", body, "");
  return {raw.status, raw.status == 200 ? parseClaimResponse(raw.body.c_str()) : std::nullopt};
}
}  // namespace api
