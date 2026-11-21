const dayTime = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const timeOnly = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const formatDayTime = (date: Date) => dayTime.format(date).replace(',', '');

export function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000);
  if (totalMinutes < 1) return '<1 min';
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours} h ${minutes} min` : `${minutes} min`;
}

export function offMessage(lastSeen: Date): string {
  return `🔴 Power is OFF\nLast signal: ${formatDayTime(lastSeen)}`;
}

export function onMessage(from: Date, to: Date): string {
  const duration = formatDuration(to.getTime() - from.getTime());
  return `🟢 Power is ON\nWas off for ${duration} (${timeOnly.format(from)} → ${timeOnly.format(to)})`;
}
