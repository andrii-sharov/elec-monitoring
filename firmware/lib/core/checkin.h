#pragma once
#include <cstdint>
#include <string>
#include <vector>

#include "reset_reason.h"
#include "wifi_log.h"

enum class CheckInType { Boot, Ping };

struct Telemetry {
  uint32_t uptimeS;
  int8_t rssi;
};

class BootSession {
 public:
  BootSession(std::string bootId, ResetReason reason, std::string fw);
  uint32_t nextSeq();
  const std::string& bootId() const { return bootId_; }
  ResetReason reason() const { return reason_; }
  const std::string& fw() const { return fw_; }

 private:
  std::string bootId_;
  ResetReason reason_;
  std::string fw_;
  uint32_t seq_ = 0;
};

struct CheckInBody {
  CheckInType type;
  uint32_t seq;
  Telemetry telemetry;
  uint32_t settingsVersion;
  std::vector<InterruptionRecord> events;
  uint16_t evicted;
};

std::string buildCheckInJson(const BootSession& session, const CheckInBody& body);
