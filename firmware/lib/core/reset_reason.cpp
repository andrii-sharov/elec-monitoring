#include "reset_reason.h"

ResetReason mapResetReason(int espResetReason) {
  switch (espResetReason) {
    case 1:
      return ResetReason::PowerOn;
    case 3:
      return ResetReason::Software;
    case 4:
      return ResetReason::Panic;
    case 5:
    case 6:
    case 7:
      return ResetReason::Watchdog;
    case 9:
      return ResetReason::Brownout;
    default:
      return ResetReason::Unknown;
  }
}

const char* resetReasonName(ResetReason reason) {
  switch (reason) {
    case ResetReason::PowerOn:
      return "POWER_ON";
    case ResetReason::Brownout:
      return "BROWNOUT";
    case ResetReason::Software:
      return "SOFTWARE";
    case ResetReason::Watchdog:
      return "WATCHDOG";
    case ResetReason::Panic:
      return "PANIC";
    case ResetReason::Unknown:
      break;
  }
  return "UNKNOWN";
}
