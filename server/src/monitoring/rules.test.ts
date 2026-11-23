import { resetReasons, type ResetReason } from '@elec/shared';
import { describe, expect, test } from 'vitest';
import { classifyCause, classifyKind, isDuplicate, offlineDeadline } from './rules.ts';

const T = new Date('2026-11-21T16:42:00Z');
const at = (s: number) => new Date(T.getTime() + s * 1000);

describe('classifyCause', () => {
  test.each(resetReasons)('unknown previous boot gives UNKNOWN for %s', (resetReason) => {
    expect(classifyCause({ previousBootId: null, bootId: 'b', resetReason })).toBe('UNKNOWN');
  });

  test.each<ResetReason>(['POWER_ON', 'BROWNOUT'])('changed boot with %s is POWER', (reason) => {
    expect(classifyCause({ previousBootId: 'a', bootId: 'b', resetReason: reason })).toBe('POWER');
  });

  test.each<ResetReason>(['SOFTWARE', 'WATCHDOG', 'PANIC', 'UNKNOWN'])(
    'changed boot with %s is UNKNOWN',
    (reason) => {
      expect(classifyCause({ previousBootId: 'a', bootId: 'b', resetReason: reason })).toBe(
        'UNKNOWN',
      );
    },
  );

  test.each(resetReasons)('same boot with %s is NETWORK', (resetReason) => {
    expect(classifyCause({ previousBootId: 'a', bootId: 'a', resetReason })).toBe('NETWORK');
  });
});

describe('classifyKind', () => {
  test('a gap just under the threshold is SHORT', () => {
    expect(classifyKind(T, new Date(T.getTime() + 179_999), 180)).toBe('SHORT');
  });

  test('a gap equal to the threshold is LONG', () => {
    expect(classifyKind(T, at(180), 180)).toBe('LONG');
  });

  test('the 25 s example is SHORT', () => {
    expect(classifyKind(T, at(25), 180)).toBe('SHORT');
  });
});

describe('offlineDeadline', () => {
  test('uses the offline timeout', () => {
    expect(offlineDeadline(T, { offlineTimeoutS: 120, previousPingIntervalS: null })).toEqual(
      at(120),
    );
  });

  test('allows twice the previous interval until settings are applied', () => {
    expect(offlineDeadline(T, { offlineTimeoutS: 120, previousPingIntervalS: 90 })).toEqual(
      at(180),
    );
  });

  test('keeps a longer offline timeout', () => {
    expect(offlineDeadline(T, { offlineTimeoutS: 300, previousPingIntervalS: 60 })).toEqual(
      at(300),
    );
  });
});

describe('isDuplicate', () => {
  test('same boot with a lower or equal seq is a duplicate', () => {
    expect(isDuplicate({ bootId: 'a', seq: 5 }, { bootId: 'a', seq: 5 })).toBe(true);
    expect(isDuplicate({ bootId: 'a', seq: 5 }, { bootId: 'a', seq: 4 })).toBe(true);
  });

  test('same boot with a higher seq is new', () => {
    expect(isDuplicate({ bootId: 'a', seq: 5 }, { bootId: 'a', seq: 6 })).toBe(false);
  });

  test('a different boot is new even with a lower seq', () => {
    expect(isDuplicate({ bootId: 'a', seq: 5 }, { bootId: 'b', seq: 1 })).toBe(false);
  });

  test('no known boot is never a duplicate', () => {
    expect(isDuplicate({ bootId: null, seq: null }, { bootId: 'a', seq: 1 })).toBe(false);
  });
});
