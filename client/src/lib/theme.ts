import { useCallback, useSyncExternalStore } from 'react';

export const themeChoices = ['system', 'light', 'dark'] as const;
export type ThemeChoice = (typeof themeChoices)[number];

const storageKey = 'em.theme';
const darkQuery = '(prefers-color-scheme: dark)';
const listeners = new Set<() => void>();

function isThemeChoice(value: string | null): value is ThemeChoice {
  return themeChoices.some((choice) => choice === value);
}

export function readTheme(): ThemeChoice {
  const stored = localStorage.getItem(storageKey);
  return isThemeChoice(stored) ? stored : 'system';
}

export function applyTheme(choice: ThemeChoice, prefersDark: boolean): void {
  const dark = choice === 'dark' || (choice === 'system' && prefersDark);
  document.documentElement.classList.toggle('dark', dark);
}

function onSystemChange(event: MediaQueryListEvent) {
  applyTheme(readTheme(), event.matches);
}

function subscribe(listener: () => void): () => void {
  const media = window.matchMedia(darkQuery);
  listeners.add(listener);
  media.addEventListener('change', onSystemChange);
  return () => {
    listeners.delete(listener);
    media.removeEventListener('change', onSystemChange);
  };
}

export function useTheme(): [ThemeChoice, (choice: ThemeChoice) => void] {
  const choice = useSyncExternalStore(subscribe, readTheme, () => 'system' as const);
  const setChoice = useCallback((next: ThemeChoice) => {
    localStorage.setItem(storageKey, next);
    applyTheme(next, window.matchMedia(darkQuery).matches);
    for (const listener of listeners) listener();
  }, []);
  return [choice, setChoice];
}
