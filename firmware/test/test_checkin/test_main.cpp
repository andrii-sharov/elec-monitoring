#include <ArduinoJson.h>
#include <unity.h>

#include "checkin.h"

namespace {
const char* kBootId = "b738bb72-4172-4edd-8b30-8d5219d8f5f3";

BootSession session() { return BootSession(kBootId, ResetReason::PowerOn, "2.0.0"); }

JsonDocument parse(const std::string& json) {
  JsonDocument doc;
  TEST_ASSERT_FALSE(deserializeJson(doc, json));
  return doc;
}

InterruptionRecord wifiRecord() { return {7, 0, 201, 900, 948}; }
InterruptionRecord apiRecord() { return {8, 1, 0, 1000, 1030}; }
}  // namespace

void test_boot_session_counts_seq_from_one() {
  BootSession s = session();
  TEST_ASSERT_EQUAL_UINT32(1, s.nextSeq());
  TEST_ASSERT_EQUAL_UINT32(2, s.nextSeq());
  TEST_ASSERT_EQUAL_UINT32(3, s.nextSeq());
}

void test_boot_body_matches_api_example() {
  CheckInBody body{CheckInType::Boot, 1, {12, -61}, 3, {}, 0};
  JsonDocument doc = parse(buildCheckInJson(session(), body));
  TEST_ASSERT_EQUAL_STRING("BOOT", doc["type"]);
  TEST_ASSERT_EQUAL_STRING(kBootId, doc["boot_id"]);
  TEST_ASSERT_EQUAL_UINT32(1, doc["seq"]);
  TEST_ASSERT_EQUAL_UINT32(12, doc["uptime_s"]);
  TEST_ASSERT_EQUAL_STRING("POWER_ON", doc["reset_reason"]);
  TEST_ASSERT_EQUAL_INT(-61, doc["rssi"]);
  TEST_ASSERT_EQUAL_STRING("2.0.0", doc["fw"]);
  TEST_ASSERT_EQUAL_UINT32(3, doc["settings_version"]);
  TEST_ASSERT_FALSE(doc["wifi"].is<JsonVariantConst>());
  TEST_ASSERT_EQUAL_size_t(8, doc.as<JsonObjectConst>().size());
}

void test_boot_never_sends_wifi() {
  CheckInBody body{CheckInType::Boot, 1, {12, -61}, 3, {wifiRecord()}, 2};
  JsonDocument doc = parse(buildCheckInJson(session(), body));
  TEST_ASSERT_FALSE(doc["wifi"].is<JsonVariantConst>());
}

void test_ping_with_events_sends_wifi() {
  CheckInBody body{CheckInType::Ping, 42, {1260, -61}, 3, {wifiRecord(), apiRecord()}, 4};
  JsonDocument doc = parse(buildCheckInJson(session(), body));
  TEST_ASSERT_EQUAL_STRING("PING", doc["type"]);
  TEST_ASSERT_EQUAL_STRING("POWER_ON", doc["reset_reason"]);
  TEST_ASSERT_EQUAL_UINT16(4, doc["wifi"]["evicted"]);
  JsonArrayConst events = doc["wifi"]["events"];
  TEST_ASSERT_EQUAL_size_t(2, events.size());
  TEST_ASSERT_EQUAL_UINT16(7, events[0]["id"]);
  TEST_ASSERT_EQUAL_STRING("WIFI", events[0]["kind"]);
  TEST_ASSERT_EQUAL_UINT32(900, events[0]["start_uptime_s"]);
  TEST_ASSERT_EQUAL_UINT32(948, events[0]["end_uptime_s"]);
  TEST_ASSERT_EQUAL_UINT16(201, events[0]["reason"]);
  TEST_ASSERT_EQUAL_STRING("API", events[1]["kind"]);
  TEST_ASSERT_TRUE(events[1]["reason"].isNull());
  TEST_ASSERT_TRUE(events[1].as<JsonObjectConst>()["reason"].is<JsonVariantConst>());
}

void test_ping_with_only_evictions_sends_wifi() {
  CheckInBody body{CheckInType::Ping, 42, {1260, -61}, 3, {}, 4};
  JsonDocument doc = parse(buildCheckInJson(session(), body));
  TEST_ASSERT_EQUAL_UINT16(4, doc["wifi"]["evicted"]);
  TEST_ASSERT_EQUAL_size_t(0, doc["wifi"]["events"].size());
}

void test_quiet_ping_omits_wifi() {
  CheckInBody body{CheckInType::Ping, 42, {1260, -61}, 3, {}, 0};
  JsonDocument doc = parse(buildCheckInJson(session(), body));
  TEST_ASSERT_FALSE(doc["wifi"].is<JsonVariantConst>());
}

void test_retry_differs_only_in_telemetry() {
  BootSession s = session();
  CheckInBody first{CheckInType::Boot, 1, {12, -61}, 3, {}, 0};
  CheckInBody retry = first;
  retry.telemetry = {16, -70};
  JsonDocument a = parse(buildCheckInJson(s, first));
  JsonDocument b = parse(buildCheckInJson(s, retry));
  TEST_ASSERT_EQUAL_UINT32(16, b["uptime_s"]);
  TEST_ASSERT_EQUAL_INT(-70, b["rssi"]);
  b["uptime_s"] = a["uptime_s"];
  b["rssi"] = a["rssi"];
  TEST_ASSERT_TRUE(a == b);
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_boot_session_counts_seq_from_one);
  RUN_TEST(test_boot_body_matches_api_example);
  RUN_TEST(test_boot_never_sends_wifi);
  RUN_TEST(test_ping_with_events_sends_wifi);
  RUN_TEST(test_ping_with_only_evictions_sends_wifi);
  RUN_TEST(test_quiet_ping_omits_wifi);
  RUN_TEST(test_retry_differs_only_in_telemetry);
  return UNITY_END();
}
