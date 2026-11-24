#pragma once
#include <cstdint>
#include <string>
#include <vector>

namespace net {
enum class EventKind { GotIp, Disconnected, LinkReady, LinkLost };

struct Event {
  EventKind kind;
  uint16_t reason;
};

void beginStation(const std::string& ssid, const std::string& password);
void beginAccessPoint(const std::string& apName);
void connectFromSetup(const std::string& ssid, const std::string& password);
void stopStation();
void discardEvents();
std::vector<Event> poll(uint64_t nowMs);
bool wifiUp();
bool linkReady();
int8_t rssi();
std::string apName();
std::vector<std::string> scan();
}  // namespace net
