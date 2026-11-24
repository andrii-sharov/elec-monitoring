import type { OutageItem } from '@elec/shared/api';

export type StripSegment = {
  kind: 'on' | 'outage' | 'blip' | 'unknown';
  start: number;
  end: number;
};

type PowerStripInput = {
  outages: OutageItem[];
  now: number;
  windowMs: number;
  complete: boolean;
};

type Interval = { kind: 'outage' | 'blip'; start: number; end: number };

function toInterval(outage: OutageItem, now: number): Interval {
  const start = Date.parse(outage.started_at);
  const end = outage.ended_at === null ? now : Date.parse(outage.ended_at);
  return {
    kind: outage.type === 'POWER_BLIP' ? 'blip' : 'outage',
    start,
    end: Math.max(start, end),
  };
}

function push(segments: StripSegment[], next: StripSegment) {
  const last = segments.at(-1);
  if (last && last.kind === next.kind && next.kind !== 'blip' && last.end === next.start) {
    last.end = next.end;
    return;
  }
  segments.push(next);
}

export function buildPowerStrip({
  outages,
  now,
  windowMs,
  complete,
}: PowerStripInput): StripSegment[] {
  const windowStart = now - windowMs;
  const intervals = outages
    .map((outage) => toInterval(outage, now))
    .toSorted((a, b) => a.start - b.start);
  const oldest = intervals[0]?.start;
  const knownFrom = complete ? windowStart : Math.max(windowStart, oldest ?? now);

  const segments: StripSegment[] = [];
  let cursor = windowStart;
  if (knownFrom > windowStart) {
    push(segments, { kind: 'unknown', start: windowStart, end: knownFrom });
    cursor = knownFrom;
  }
  for (const interval of intervals) {
    const end = Math.min(interval.end, now);
    if (end < cursor || (end === cursor && interval.kind === 'outage')) continue;
    const start = Math.max(interval.start, cursor);
    if (start > cursor) push(segments, { kind: 'on', start: cursor, end: start });
    push(segments, { kind: interval.kind, start, end });
    cursor = end;
  }
  if (cursor < now) push(segments, { kind: 'on', start: cursor, end: now });
  return segments;
}
