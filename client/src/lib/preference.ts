import { useSyncExternalStore } from 'react';

export type Preference<T extends string> = {
  read(): T;
  write(value: T): void;
  use(): [T, (value: T) => void];
};

type PreferenceOptions<T extends string> = {
  key: string;
  choices: readonly T[];
  fallback: T;
  apply(value: T): void;
};

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

export function createPreference<T extends string>({
  key,
  choices,
  fallback,
  apply,
}: PreferenceOptions<T>): Preference<T> {
  const listeners = new Set<() => void>();

  function read(): T {
    const stored = readStorage(key);
    return choices.find((choice) => choice === stored) ?? fallback;
  }

  function write(value: T): void {
    writeStorage(key, value);
    apply(value);
    for (const listener of listeners) listener();
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  function use(): [T, (value: T) => void] {
    return [useSyncExternalStore(subscribe, read, () => fallback), write];
  }

  return { read, write, use };
}
