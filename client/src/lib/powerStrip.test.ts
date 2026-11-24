import type { OutageItem } from '@elec/shared/api';
import { describe, expect, test } from 'vitest';
import { outageFixture } from '../../test/fixtures.ts';
import { buildPowerStrip, type StripSegment } from './powerStrip.ts';

const hour = 3_600_000;
const day = 24 * hour;
const windowMs = 7 * day;
const now = Date.parse('2026-11-21T18:00:00Z');
const windowStart = now - windowMs;

function at(ms: number): string {
  return new Date(ms).toISOString();
}

function outage(start: number, end: number | null, overrides: Partial<OutageItem> = {}) {
  return outageFixture({
    id: `o-${start}`,
    started_at: at(start),
    ended_at: end === null ? null : at(end),
    duration_s: end === null ? null : (end - start) / 1000,
    ...overrides,
  });
}

function expectWellFormed(segments: StripSegment[]) {
  expect(segments[0]?.start).toBe(windowStart);
  expect(segments.at(-1)?.end).toBe(now);
  for (const segment of segments) expect(segment.end).toBeGreaterThanOrEqual(segment.start);
  const starts = segments.slice(1).map((segment) => segment.start);
  expect(starts).toEqual(segments.slice(0, -1).map((segment) => segment.end));
  const total = segments.reduce((sum, s) => sum + (s.end - s.start), 0);
  expect(total).toBe(windowMs);
}

describe('buildPowerStrip', () => {
  test('no outages and complete history is one on segment', () => {
    expect(buildPowerStrip({ outages: [], now, windowMs, complete: true })).toEqual([
      { kind: 'on', start: windowStart, end: now },
    ]);
  });

  test('no outages and incomplete history is one unknown segment', () => {
    expect(buildPowerStrip({ outages: [], now, windowMs, complete: false })).toEqual([
      { kind: 'unknown', start: windowStart, end: now },
    ]);
  });

  test('an open outage runs to now', () => {
    const segments = buildPowerStrip({
      outages: [outage(now - 2 * hour, null)],
      now,
      windowMs,
      complete: true,
    });
    expect(segments).toEqual([
      { kind: 'on', start: windowStart, end: now - 2 * hour },
      { kind: 'outage', start: now - 2 * hour, end: now },
    ]);
  });

  test('an outage that started before the window is clipped to the window start', () => {
    const segments = buildPowerStrip({
      outages: [outage(windowStart - day, windowStart + hour)],
      now,
      windowMs,
      complete: true,
    });
    expect(segments[0]).toEqual({ kind: 'outage', start: windowStart, end: windowStart + hour });
    expectWellFormed(segments);
  });

  test('with more pages, time before the oldest loaded outage is unknown', () => {
    const outages = Array.from({ length: 20 }, (_, i) =>
      outage(now - (i + 1) * 2 * hour, now - (i + 1) * 2 * hour + 30 * 60_000),
    );
    const segments = buildPowerStrip({ outages, now, windowMs, complete: false });
    const oldest = now - 40 * hour;
    expect(segments[0]).toEqual({ kind: 'unknown', start: windowStart, end: oldest });
    expect(segments[1]).toMatchObject({ kind: 'outage', start: oldest });
    expect(segments.filter((s) => s.kind === 'outage')).toHaveLength(20);
    expectWellFormed(segments);
  });

  test('a power blip becomes a blip segment even with no duration', () => {
    const start = now - 5 * hour;
    const segments = buildPowerStrip({
      outages: [outage(start, start, { type: 'POWER_BLIP', duration_s: 0 })],
      now,
      windowMs,
      complete: true,
    });
    expect(segments).toEqual([
      { kind: 'on', start: windowStart, end: start },
      { kind: 'blip', start, end: start },
      { kind: 'on', start, end: now },
    ]);
  });

  test('segments are sorted, contiguous and never overlap, whatever the input order', () => {
    const segments = buildPowerStrip({
      outages: [
        outage(now - 3 * hour, now - 2 * hour),
        outage(now - 6 * day, now - 5 * day),
        outage(now - 2.5 * hour, now - hour),
        outage(now - 30 * 60_000, null),
      ],
      now,
      windowMs,
      complete: true,
    });
    expectWellFormed(segments);
    expect(segments.map((s) => s.kind)).toEqual(['on', 'outage', 'on', 'outage', 'on', 'outage']);
  });
});
