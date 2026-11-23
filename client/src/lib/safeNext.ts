const fallback = '/devices';

export function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith('/')) return fallback;
  if (raw.startsWith('//') || raw.startsWith('/\\')) return fallback;
  if (/\p{Cc}/u.test(raw)) return fallback;
  return raw;
}
