#pragma once
#include <cstddef>
#include <cstdint>
#include <optional>

enum class InterruptionKind : uint8_t { Wifi = 0, Api = 1 };

struct InterruptionRecord {
  uint16_t id;
  uint8_t kind;
  uint16_t reason;
  uint32_t startUptimeS;
  uint32_t endUptimeS;
};

class WifiLog {
 public:
  static constexpr size_t kCapacity = 16;

  void onGotIp(uint32_t uptimeS);
  void onDisconnected(uint32_t uptimeS, uint16_t reason);
  void onApiFailure(uint32_t uptimeS);
  void onApiSuccess(uint32_t uptimeS);
  void setPlanned(bool planned);
  size_t snapshot(InterruptionRecord* out, size_t max) const;
  void acknowledge(const uint16_t* ids, size_t count);
  uint16_t evicted() const;

 private:
  struct Open {
    InterruptionKind kind;
    uint16_t reason;
    uint32_t startUptimeS;
  };

  void close(uint32_t endUptimeS);

  InterruptionRecord records_[kCapacity] = {};
  size_t count_ = 0;
  uint16_t nextId_ = 1;
  uint16_t evicted_ = 0;
  std::optional<Open> open_;
  bool wifiUp_ = false;
  bool planned_ = false;
};
