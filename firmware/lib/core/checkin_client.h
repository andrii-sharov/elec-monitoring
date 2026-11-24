#pragma once
#include <cstdint>
#include <optional>
#include <string>
#include <vector>

#include "checkin.h"
#include "scheduler.h"
#include "wifi_log.h"

struct PreparedCheckIn {
  CheckInType type;
  uint32_t seq;
  std::string json;
  std::vector<uint16_t> eventIds;
};

class CheckInClient {
 public:
  CheckInClient(BootSession& session, CheckInScheduler& scheduler, WifiLog& log);
  std::optional<PreparedCheckIn> prepare(uint64_t nowMs, int8_t rssi, uint32_t settingsVersion);
  CheckInOutcome complete(const PreparedCheckIn& sent, int httpStatus,
                          std::optional<uint32_t> retryAfterS, uint64_t nowMs, bool wifiUp);

 private:
  BootSession& session_;
  CheckInScheduler& scheduler_;
  WifiLog& log_;
  uint32_t bootSeq_ = 0;
};
