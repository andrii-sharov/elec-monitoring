import { useEffect, useState } from 'react';

export function useStateChange<T>(value: T, durationMs = 1200): boolean {
  const [previous, setPrevious] = useState(value);
  const [changes, setChanges] = useState(0);
  const [settled, setSettled] = useState(0);
  if (!Object.is(previous, value)) {
    setPrevious(value);
    setChanges(changes + 1);
  }
  useEffect(() => {
    if (changes === settled) return;
    const id = setTimeout(() => setSettled(changes), durationMs);
    return () => clearTimeout(id);
  }, [changes, settled, durationMs]);
  return changes !== settled;
}
