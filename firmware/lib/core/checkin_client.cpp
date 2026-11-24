#include "checkin_client.h"

namespace {
uint32_t uptimeS(uint64_t nowMs) { return static_cast<uint32_t>(nowMs / 1000); }
}  // namespace

CheckInClient::CheckInClient(BootSession& session, CheckInScheduler& scheduler, WifiLog& log)
    : session_(session), scheduler_(scheduler), log_(log) {}

std::optional<PreparedCheckIn> CheckInClient::prepare(uint64_t nowMs, int8_t rssi,
                                                      uint32_t settingsVersion) {
  std::optional<Due> due = scheduler_.due(nowMs);
  if (!due) return std::nullopt;

  CheckInBody body{due->type, 0, {uptimeS(nowMs), rssi}, settingsVersion, {}, 0};
  if (due->type == CheckInType::Boot) {
    if (!due->retry || bootSeq_ == 0) bootSeq_ = session_.nextSeq();
    body.seq = bootSeq_;
  } else {
    body.seq = session_.nextSeq();
    InterruptionRecord records[WifiLog::kCapacity];
    size_t count = log_.snapshot(records, WifiLog::kCapacity);
    body.events.assign(records, records + count);
    body.evicted = log_.evicted();
  }

  PreparedCheckIn prepared{body.type, body.seq, buildCheckInJson(session_, body), {}};
  for (const InterruptionRecord& record : body.events) prepared.eventIds.push_back(record.id);
  return prepared;
}

CheckInOutcome CheckInClient::complete(const PreparedCheckIn& sent, int httpStatus,
                                       std::optional<uint32_t> retryAfterS, uint64_t nowMs,
                                       bool wifiUp) {
  CheckInOutcome outcome = outcomeForStatus(httpStatus);
  scheduler_.onResult(sent.type, outcome, retryAfterS, nowMs);

  if (outcome == CheckInOutcome::Accepted) {
    log_.onApiSuccess(uptimeS(nowMs));
    log_.acknowledge(sent.eventIds.data(), sent.eventIds.size());
  } else if (wifiUp && (outcome == CheckInOutcome::NetworkError ||
                        outcome == CheckInOutcome::ServerError)) {
    log_.onApiFailure(uptimeS(nowMs));
  }
  return outcome;
}
