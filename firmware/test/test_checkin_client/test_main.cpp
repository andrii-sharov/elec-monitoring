#include <ArduinoJson.h>
#include <unity.h>

#include "../support/fake_random.h"
#include "checkin_client.h"

namespace {
constexpr uint64_t kS = 1000;

struct Rig {
  FixedRandom random{0xffffffff};
  BootSession session{"b738bb72-4172-4edd-8b30-8d5219d8f5f3", ResetReason::PowerOn, "2.0.0"};
  CheckInScheduler scheduler{30, random};
  WifiLog log;
  CheckInClient client{session, scheduler, log};

  Rig() {
    log.onGotIp(1);
    scheduler.onLinkReady(0);
  }
};

JsonDocument parse(const std::string& json) {
  JsonDocument doc;
  TEST_ASSERT_FALSE(deserializeJson(doc, json));
  return doc;
}

void addWifiRecord(WifiLog& log, uint32_t at) {
  log.onDisconnected(at, 201);
  log.onGotIp(at + 5);
}
}  // namespace

void test_nothing_prepared_when_not_due() {
  Rig rig;
  rig.scheduler.onLinkLost(0);
  TEST_ASSERT_FALSE(rig.client.prepare(0, -60, 1).has_value());
}

void test_boot_retry_keeps_seq_and_ping_takes_next() {
  Rig rig;
  auto boot = rig.client.prepare(0, -60, 1);
  TEST_ASSERT_TRUE(boot.has_value());
  TEST_ASSERT_EQUAL_UINT32(1, boot->seq);
  rig.client.complete(*boot, -1, std::nullopt, 0, true);

  auto retry = rig.client.prepare(2 * kS, -70, 1);
  TEST_ASSERT_TRUE(retry.has_value());
  TEST_ASSERT_EQUAL_UINT32(1, retry->seq);
  JsonDocument doc = parse(retry->json);
  TEST_ASSERT_EQUAL_STRING("BOOT", doc["type"]);
  TEST_ASSERT_EQUAL_UINT32(2, doc["uptime_s"]);
  TEST_ASSERT_EQUAL_INT(-70, doc["rssi"]);
  rig.client.complete(*retry, 204, std::nullopt, 2 * kS, true);

  auto ping = rig.client.prepare(32 * kS, -60, 1);
  TEST_ASSERT_TRUE(ping.has_value());
  TEST_ASSERT_EQUAL_UINT32(2, ping->seq);
  TEST_ASSERT_EQUAL_STRING("PING", parse(ping->json)["type"]);
}

void test_ping_sends_completed_records_and_acknowledges_them() {
  Rig rig;
  auto boot = rig.client.prepare(0, -60, 1);
  rig.client.complete(*boot, 204, std::nullopt, 0, true);
  addWifiRecord(rig.log, 10);
  addWifiRecord(rig.log, 20);

  auto ping = rig.client.prepare(30 * kS, -60, 1);
  TEST_ASSERT_EQUAL_size_t(2, ping->eventIds.size());
  TEST_ASSERT_EQUAL_size_t(2, parse(ping->json)["wifi"]["events"].size());
  addWifiRecord(rig.log, 25);
  rig.client.complete(*ping, 204, std::nullopt, 30 * kS, true);

  InterruptionRecord left[WifiLog::kCapacity];
  TEST_ASSERT_EQUAL_size_t(1, rig.log.snapshot(left, WifiLog::kCapacity));
  TEST_ASSERT_EQUAL_UINT16(3, left[0].id);
}

void test_failed_ping_keeps_records() {
  Rig rig;
  auto boot = rig.client.prepare(0, -60, 1);
  rig.client.complete(*boot, 204, std::nullopt, 0, true);
  addWifiRecord(rig.log, 10);
  auto ping = rig.client.prepare(30 * kS, -60, 1);
  rig.client.complete(*ping, 429, 30, 30 * kS, true);
  InterruptionRecord left[WifiLog::kCapacity];
  TEST_ASSERT_EQUAL_size_t(1, rig.log.snapshot(left, WifiLog::kCapacity));
}

void test_network_failure_opens_api_record_until_accepted() {
  Rig rig;
  auto boot = rig.client.prepare(100 * kS, -60, 1);
  TEST_ASSERT_EQUAL_INT(static_cast<int>(CheckInOutcome::NetworkError),
                        static_cast<int>(rig.client.complete(*boot, -1, std::nullopt, 100 * kS, true)));
  auto retry = rig.client.prepare(102 * kS, -60, 1);
  rig.client.complete(*retry, 503, std::nullopt, 102 * kS, true);
  auto again = rig.client.prepare(106 * kS, -60, 1);
  rig.client.complete(*again, 204, std::nullopt, 130 * kS, true);

  InterruptionRecord records[WifiLog::kCapacity];
  TEST_ASSERT_EQUAL_size_t(1, rig.log.snapshot(records, WifiLog::kCapacity));
  TEST_ASSERT_EQUAL_UINT8(static_cast<uint8_t>(InterruptionKind::Api), records[0].kind);
  TEST_ASSERT_EQUAL_UINT32(100, records[0].startUptimeS);
  TEST_ASSERT_EQUAL_UINT32(130, records[0].endUptimeS);
}

void test_network_failure_without_wifi_opens_nothing() {
  Rig rig;
  auto boot = rig.client.prepare(100 * kS, -60, 1);
  rig.client.complete(*boot, -1, std::nullopt, 100 * kS, false);
  auto retry = rig.client.prepare(102 * kS, -60, 1);
  rig.client.complete(*retry, 204, std::nullopt, 102 * kS, true);
  InterruptionRecord records[WifiLog::kCapacity];
  TEST_ASSERT_EQUAL_size_t(0, rig.log.snapshot(records, WifiLog::kCapacity));
}

void test_rate_limit_and_bad_request_are_not_api_interruptions() {
  Rig rig;
  auto boot = rig.client.prepare(100 * kS, -60, 1);
  rig.client.complete(*boot, 429, 5, 100 * kS, true);
  auto retry = rig.client.prepare(105 * kS, -60, 1);
  rig.client.complete(*retry, 400, std::nullopt, 105 * kS, true);
  auto ping = rig.client.prepare(135 * kS, -60, 1);
  rig.client.complete(*ping, 204, std::nullopt, 135 * kS, true);
  InterruptionRecord records[WifiLog::kCapacity];
  TEST_ASSERT_EQUAL_size_t(0, rig.log.snapshot(records, WifiLog::kCapacity));
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_nothing_prepared_when_not_due);
  RUN_TEST(test_boot_retry_keeps_seq_and_ping_takes_next);
  RUN_TEST(test_ping_sends_completed_records_and_acknowledges_them);
  RUN_TEST(test_failed_ping_keeps_records);
  RUN_TEST(test_network_failure_opens_api_record_until_accepted);
  RUN_TEST(test_network_failure_without_wifi_opens_nothing);
  RUN_TEST(test_rate_limit_and_bad_request_are_not_api_interruptions);
  return UNITY_END();
}
