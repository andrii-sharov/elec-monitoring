import { useEffect, useState } from 'react';

export function useSecondsLeft(expiresAt: string): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now) / 1000));
}
