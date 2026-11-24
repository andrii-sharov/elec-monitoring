#pragma once

enum class ResetReason { PowerOn, Brownout, Software, Watchdog, Panic, Unknown };

ResetReason mapResetReason(int espResetReason);
const char* resetReasonName(ResetReason reason);
