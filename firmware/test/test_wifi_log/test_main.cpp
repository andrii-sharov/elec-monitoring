#include <unity.h>

#include <vector>

#include "wifi_log.h"

static_assert(sizeof(InterruptionRecord) * WifiLog::kCapacity <= 512, "Wi-Fi log too big");

namespace {
std::vector<InterruptionRecord> all(const WifiLog& log) {
  InterruptionRecord out[WifiLog::kCapacity];
  size_t n = log.snapshot(out, WifiLog::kCapacity);
  return std::vector<InterruptionRecord>(out, out + n);
}

void assertRecord(const InterruptionRecord& r, uint16_t id, InterruptionKind kind, uint32_t start,
                  uint32_t end, uint16_t reason) {
  TEST_ASSERT_EQUAL_UINT16(id, r.id);
  TEST_ASSERT_EQUAL_UINT8(static_cast<uint8_t>(kind), r.kind);
  TEST_ASSERT_EQUAL_UINT32(start, r.startUptimeS);
  TEST_ASSERT_EQUAL_UINT32(end, r.endUptimeS);
  TEST_ASSERT_EQUAL_UINT16(reason, r.reason);
}

void addWifiRecords(WifiLog& log, int count, uint32_t& t) {
  for (int i = 0; i < count; i++) {
    log.onDisconnected(t, 200);
    log.onGotIp(t + 1);
    t += 10;
  }
}

std::vector<uint16_t> ids(const WifiLog& log) {
  std::vector<uint16_t> out;
  for (const auto& r : all(log)) out.push_back(r.id);
  return out;
}
}  // namespace

void test_disconnect_before_first_ip_is_ignored() {
  WifiLog log;
  log.onDisconnected(5, 201);
  log.onGotIp(10);
  TEST_ASSERT_EQUAL_size_t(0, all(log).size());
}

void test_failed_reconnects_fold_into_one_record() {
  WifiLog log;
  log.onGotIp(10);
  log.onDisconnected(900, 201);
  log.onDisconnected(910, 15);
  log.onDisconnected(920, 201);
  log.onDisconnected(930, 2);
  TEST_ASSERT_EQUAL_size_t(0, all(log).size());
  log.onGotIp(948);
  auto records = all(log);
  TEST_ASSERT_EQUAL_size_t(1, records.size());
  assertRecord(records[0], 1, InterruptionKind::Wifi, 900, 948, 201);
}

void test_api_failures_fold_until_success() {
  WifiLog log;
  log.onGotIp(10);
  log.onApiFailure(100);
  log.onApiFailure(130);
  log.onApiSuccess(160);
  auto records = all(log);
  TEST_ASSERT_EQUAL_size_t(1, records.size());
  assertRecord(records[0], 1, InterruptionKind::Api, 100, 160, 0);
}

void test_api_success_without_failure_adds_nothing() {
  WifiLog log;
  log.onGotIp(10);
  log.onApiSuccess(20);
  TEST_ASSERT_EQUAL_size_t(0, all(log).size());
}

void test_disconnect_closes_api_and_opens_wifi() {
  WifiLog log;
  log.onGotIp(10);
  log.onApiFailure(100);
  log.onDisconnected(140, 8);
  log.onGotIp(170);
  auto records = all(log);
  TEST_ASSERT_EQUAL_size_t(2, records.size());
  assertRecord(records[0], 1, InterruptionKind::Api, 100, 140, 0);
  assertRecord(records[1], 2, InterruptionKind::Wifi, 140, 170, 8);
}

void test_api_failure_while_wifi_down_is_ignored() {
  WifiLog log;
  log.onGotIp(10);
  log.onDisconnected(100, 201);
  log.onApiFailure(110);
  log.onGotIp(120);
  auto records = all(log);
  TEST_ASSERT_EQUAL_size_t(1, records.size());
  assertRecord(records[0], 1, InterruptionKind::Wifi, 100, 120, 201);
}

void test_keeps_newest_sixteen_and_counts_evictions() {
  WifiLog log;
  log.onGotIp(1);
  uint32_t t = 10;
  addWifiRecords(log, 20, t);
  auto got = ids(log);
  TEST_ASSERT_EQUAL_size_t(16, got.size());
  for (size_t i = 0; i < got.size(); i++) TEST_ASSERT_EQUAL_UINT16(5 + i, got[i]);
  TEST_ASSERT_EQUAL_UINT16(4, log.evicted());
}

void test_evicted_saturates() {
  WifiLog log;
  log.onGotIp(1);
  uint32_t t = 10;
  addWifiRecords(log, 70000, t);
  TEST_ASSERT_EQUAL_UINT16(65535, log.evicted());
}

void test_snapshot_respects_max() {
  WifiLog log;
  log.onGotIp(1);
  uint32_t t = 10;
  addWifiRecords(log, 5, t);
  InterruptionRecord out[2];
  TEST_ASSERT_EQUAL_size_t(2, log.snapshot(out, 2));
  TEST_ASSERT_EQUAL_UINT16(1, out[0].id);
  TEST_ASSERT_EQUAL_UINT16(2, out[1].id);
}

void test_ack_keeps_record_completed_in_flight() {
  WifiLog log;
  log.onGotIp(1);
  uint32_t t = 10;
  addWifiRecords(log, 3, t);
  auto sent = ids(log);
  addWifiRecords(log, 1, t);
  log.acknowledge(sent.data(), sent.size());
  auto got = ids(log);
  TEST_ASSERT_EQUAL_size_t(1, got.size());
  TEST_ASSERT_EQUAL_UINT16(4, got[0]);
}

void test_ack_keeps_records_added_after_evictions_in_flight() {
  WifiLog log;
  log.onGotIp(1);
  uint32_t t = 10;
  addWifiRecords(log, 16, t);
  auto sent = ids(log);
  addWifiRecords(log, 2, t);
  log.acknowledge(sent.data(), sent.size());
  auto got = ids(log);
  TEST_ASSERT_EQUAL_size_t(2, got.size());
  TEST_ASSERT_EQUAL_UINT16(17, got[0]);
  TEST_ASSERT_EQUAL_UINT16(18, got[1]);
}

void test_ack_of_unknown_ids_changes_nothing() {
  WifiLog log;
  log.onGotIp(1);
  uint32_t t = 10;
  addWifiRecords(log, 2, t);
  uint16_t unknown[] = {7, 99};
  log.acknowledge(unknown, 2);
  TEST_ASSERT_EQUAL_size_t(2, ids(log).size());
}

void test_ids_keep_counting_after_ack() {
  WifiLog log;
  log.onGotIp(1);
  uint32_t t = 10;
  addWifiRecords(log, 2, t);
  auto sent = ids(log);
  log.acknowledge(sent.data(), sent.size());
  addWifiRecords(log, 1, t);
  TEST_ASSERT_EQUAL_UINT16(3, ids(log)[0]);
}

void test_planned_ignores_disconnects() {
  WifiLog log;
  log.onGotIp(1);
  log.setPlanned(true);
  log.onDisconnected(50, 8);
  log.onGotIp(60);
  TEST_ASSERT_EQUAL_size_t(0, all(log).size());
}

void test_planned_drops_open_interruption() {
  WifiLog log;
  log.onGotIp(1);
  log.onDisconnected(50, 201);
  log.setPlanned(true);
  log.onGotIp(60);
  log.setPlanned(false);
  TEST_ASSERT_EQUAL_size_t(0, all(log).size());
  log.onDisconnected(70, 201);
  log.onGotIp(80);
  auto records = all(log);
  TEST_ASSERT_EQUAL_size_t(1, records.size());
  assertRecord(records[0], 1, InterruptionKind::Wifi, 70, 80, 201);
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_disconnect_before_first_ip_is_ignored);
  RUN_TEST(test_failed_reconnects_fold_into_one_record);
  RUN_TEST(test_api_failures_fold_until_success);
  RUN_TEST(test_api_success_without_failure_adds_nothing);
  RUN_TEST(test_disconnect_closes_api_and_opens_wifi);
  RUN_TEST(test_api_failure_while_wifi_down_is_ignored);
  RUN_TEST(test_keeps_newest_sixteen_and_counts_evictions);
  RUN_TEST(test_evicted_saturates);
  RUN_TEST(test_snapshot_respects_max);
  RUN_TEST(test_ack_keeps_record_completed_in_flight);
  RUN_TEST(test_ack_keeps_records_added_after_evictions_in_flight);
  RUN_TEST(test_ack_of_unknown_ids_changes_nothing);
  RUN_TEST(test_ids_keep_counting_after_ack);
  RUN_TEST(test_planned_ignores_disconnects);
  RUN_TEST(test_planned_drops_open_interruption);
  return UNITY_END();
}
