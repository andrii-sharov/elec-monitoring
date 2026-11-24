#include <Arduino.h>
#include <mbedtls/pk.h>
#include <mbedtls/sha256.h>

extern const char otaKeyPem[] asm("_binary_keys_ota_signing_pub_pem_start");

static String otaKeyFingerprint() {
  mbedtls_pk_context pk;
  mbedtls_pk_init(&pk);
  String out = "invalid";
  if (mbedtls_pk_parse_public_key(&pk, reinterpret_cast<const unsigned char*>(otaKeyPem),
                                  strlen(otaKeyPem) + 1) == 0) {
    unsigned char der[200];
    int len = mbedtls_pk_write_pubkey_der(&pk, der, sizeof(der));
    if (len > 0) {
      unsigned char hash[32];
      mbedtls_sha256(der + sizeof(der) - len, len, hash, 0);
      char hex[17];
      for (int i = 0; i < 8; i++) snprintf(hex + i * 2, 3, "%02x", hash[i]);
      out = hex;
    }
  }
  mbedtls_pk_free(&pk);
  return out;
}

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.printf("boot fw %s server %s ota key %s\n", FW_VERSION, SERVER_URL,
                otaKeyFingerprint().c_str());
}

void loop() { delay(1000); }
