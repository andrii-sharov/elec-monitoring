import { expect, test } from 'vitest';
import {
  emailSchema,
  languageSchema,
  nameSchema,
  passwordSchema,
  settingsPatchSchema,
  timezoneSchema,
} from './index.ts';

test('emailSchema trims and lowercases', () => {
  expect(emailSchema.parse('  John@Example.COM ')).toBe('john@example.com');
  expect(emailSchema.safeParse('not-an-email').success).toBe(false);
});

test('passwordSchema needs 8 to 128 characters', () => {
  expect(passwordSchema.safeParse('1234567').success).toBe(false);
  expect(passwordSchema.safeParse('12345678').success).toBe(true);
  expect(passwordSchema.safeParse('x'.repeat(128)).success).toBe(true);
  expect(passwordSchema.safeParse('x'.repeat(129)).success).toBe(false);
});

test('nameSchema trims and rejects blanks', () => {
  expect(nameSchema.parse('  Johnny ')).toBe('Johnny');
  expect(nameSchema.safeParse('   ').success).toBe(false);
  expect(nameSchema.safeParse('x'.repeat(101)).success).toBe(false);
});

test('languageSchema accepts only supported languages', () => {
  expect(languageSchema.parse('uk')).toBe('uk');
  expect(languageSchema.safeParse('de').success).toBe(false);
});

test('timezoneSchema accepts IANA names and canonicalizes them', () => {
  expect(timezoneSchema.parse('Europe/Kyiv')).toBe('Europe/Kyiv');
  expect(timezoneSchema.parse('utc')).toBe('UTC');
  expect(timezoneSchema.safeParse('Mars/Base').success).toBe(false);
});

test('quiet hours with equal times fail with a reason param and no message text', () => {
  const result = settingsPatchSchema.safeParse({ quiet_hours: { start: '22:00', end: '22:00' } });
  expect(result.success).toBe(false);
  const issue = result.error?.issues[0];
  expect(issue?.path).toEqual(['quiet_hours', 'end']);
  expect(issue?.code).toBe('custom');
  expect(issue && 'params' in issue ? issue.params : undefined).toEqual({ reason: 'same_time' });
});
