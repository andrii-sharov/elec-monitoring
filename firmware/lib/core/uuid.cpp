#include "uuid.h"

#include <cstdio>

std::string uuidV4(Random& random) {
  uint8_t bytes[16];
  for (int word = 0; word < 4; word++) {
    uint32_t value = random.next();
    for (int i = 0; i < 4; i++) bytes[word * 4 + i] = static_cast<uint8_t>(value >> (24 - 8 * i));
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  char out[37];
  char* p = out;
  for (int i = 0; i < 16; i++) {
    if (i == 4 || i == 6 || i == 8 || i == 10) *p++ = '-';
    p += snprintf(p, 3, "%02x", bytes[i]);
  }
  return std::string(out, 36);
}
