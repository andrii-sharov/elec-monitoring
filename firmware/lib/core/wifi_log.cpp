#include "wifi_log.h"

#include <algorithm>

void WifiLog::onGotIp(uint32_t uptimeS) {
  wifiUp_ = true;
  if (open_ && open_->kind == InterruptionKind::Wifi) close(uptimeS);
}

void WifiLog::onDisconnected(uint32_t uptimeS, uint16_t reason) {
  bool wasUp = wifiUp_;
  wifiUp_ = false;
  if (!wasUp || planned_) return;
  if (open_) close(uptimeS);
  open_ = Open{InterruptionKind::Wifi, reason, uptimeS};
}

void WifiLog::onApiFailure(uint32_t uptimeS) {
  if (!wifiUp_ || planned_ || open_) return;
  open_ = Open{InterruptionKind::Api, 0, uptimeS};
}

void WifiLog::onApiSuccess(uint32_t uptimeS) {
  if (open_ && open_->kind == InterruptionKind::Api) close(uptimeS);
}

void WifiLog::setPlanned(bool planned) {
  planned_ = planned;
  if (planned) open_.reset();
}

size_t WifiLog::snapshot(InterruptionRecord* out, size_t max) const {
  size_t n = std::min(count_, max);
  std::copy(records_, records_ + n, out);
  return n;
}

void WifiLog::acknowledge(const uint16_t* ids, size_t count) {
  size_t kept = 0;
  for (size_t i = 0; i < count_; i++) {
    if (std::find(ids, ids + count, records_[i].id) == ids + count) records_[kept++] = records_[i];
  }
  count_ = kept;
}

uint16_t WifiLog::evicted() const { return evicted_; }

void WifiLog::close(uint32_t endUptimeS) {
  if (count_ == kCapacity) {
    std::copy(records_ + 1, records_ + kCapacity, records_);
    count_--;
    if (evicted_ < UINT16_MAX) evicted_++;
  }
  records_[count_++] = InterruptionRecord{nextId_++, static_cast<uint8_t>(open_->kind),
                                          open_->reason, open_->startUptimeS, endUptimeS};
  open_.reset();
}
