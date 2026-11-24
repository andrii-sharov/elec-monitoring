#include "checkin.h"

#include <ArduinoJson.h>

BootSession::BootSession(std::string bootId, ResetReason reason, std::string fw)
    : bootId_(std::move(bootId)), reason_(reason), fw_(std::move(fw)) {}

uint32_t BootSession::nextSeq() { return ++seq_; }

std::string buildCheckInJson(const BootSession& session, const CheckInBody& body) {
  JsonDocument doc;
  doc["type"] = body.type == CheckInType::Boot ? "BOOT" : "PING";
  doc["boot_id"] = session.bootId();
  doc["seq"] = body.seq;
  doc["uptime_s"] = body.telemetry.uptimeS;
  doc["reset_reason"] = resetReasonName(session.reason());
  doc["rssi"] = body.telemetry.rssi;
  doc["fw"] = session.fw();
  doc["settings_version"] = body.settingsVersion;

  if (body.type == CheckInType::Ping && (!body.events.empty() || body.evicted > 0)) {
    JsonObject wifi = doc["wifi"].to<JsonObject>();
    wifi["evicted"] = body.evicted;
    JsonArray events = wifi["events"].to<JsonArray>();
    for (const InterruptionRecord& record : body.events) {
      JsonObject event = events.add<JsonObject>();
      bool api = record.kind == static_cast<uint8_t>(InterruptionKind::Api);
      event["id"] = record.id;
      event["kind"] = api ? "API" : "WIFI";
      event["start_uptime_s"] = record.startUptimeS;
      event["end_uptime_s"] = record.endUptimeS;
      if (api) {
        event["reason"] = nullptr;
      } else {
        event["reason"] = record.reason;
      }
    }
  }

  std::string out;
  serializeJson(doc, out);
  return out;
}
