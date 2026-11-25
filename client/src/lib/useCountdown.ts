import { useEffect, useState } from 'react';

export function useSecondsLeft(expiresAt: string): number;
export function useSecondsLeft(expiresAt: string | null): number | null;
export function useSecondsLeft(expiresAt: string | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (expiresAt === null) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [expiresAt]);
  if (expiresAt === null) return null;
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now) / 1000));
}
