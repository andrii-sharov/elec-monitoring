#include <unity.h>

#include <cctype>

#include "../support/fake_random.h"
#include "uuid.h"

void test_formats_random_words_as_v4() {
  SequenceRandom random({0x01234567, 0x89abcdef, 0xfedcba98, 0x76543210});
  TEST_ASSERT_EQUAL_STRING("01234567-89ab-4def-bedc-ba9876543210", uuidV4(random).c_str());
}

void test_version_and_variant_bits_are_forced() {
  FixedRandom random(0xffffffff);
  std::string id = uuidV4(random);
  TEST_ASSERT_EQUAL_size_t(36, id.size());
  TEST_ASSERT_EQUAL_CHAR('4', id[14]);
  TEST_ASSERT_EQUAL_CHAR('b', id[19]);
  FixedRandom zero(0);
  std::string low = uuidV4(zero);
  TEST_ASSERT_EQUAL_STRING("00000000-0000-4000-8000-000000000000", low.c_str());
}

void test_is_lowercase() {
  FixedRandom random(0xabcdefab);
  for (char c : uuidV4(random)) {
    TEST_ASSERT_FALSE(std::isupper(static_cast<unsigned char>(c)));
  }
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_formats_random_words_as_v4);
  RUN_TEST(test_version_and_variant_bits_are_forced);
  RUN_TEST(test_is_lowercase);
  return UNITY_END();
}
