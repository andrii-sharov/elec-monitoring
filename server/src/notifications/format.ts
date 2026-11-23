import { momentParts } from '@elec/shared';

export type QuietHours = { start: string; end: string };

function minutesOf(value: string): number {
  const [h = '0', m = '0'] = value.split(':');
  return Number(h) * 60 + Number(m);
}

export function isQuietTime(now: Date, quiet: QuietHours | null, timezone: string): boolean {
  if (!quiet) return false;
  const { time } = momentParts(now, 'en-GB', timezone);
  const current = minutesOf(time);
  const start = minutesOf(quiet.start);
  const end = minutesOf(quiet.end);
  if (start === end) return false;
  return start < end ? current >= start && current < end : current >= start || current < end;
}
