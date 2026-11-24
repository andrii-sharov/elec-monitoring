import { useEffect } from 'react';
import { createPreference } from './preference.ts';

export const themeChoices = ['system', 'light', 'dark'] as const;
export type ThemeChoice = (typeof themeChoices)[number];

const darkQuery = '(prefers-color-scheme: dark)';

export function applyTheme(choice: ThemeChoice, prefersDark: boolean): void {
  const dark = choice === 'dark' || (choice === 'system' && prefersDark);
  document.documentElement.classList.toggle('dark', dark);
}

const themePreference = createPreference({
  key: 'em.theme',
  choices: themeChoices,
  fallback: 'system',
  apply: (choice) => applyTheme(choice, window.matchMedia(darkQuery).matches),
});

export const readTheme = themePreference.read;

function onSystemChange(event: MediaQueryListEvent) {
  applyTheme(readTheme(), event.matches);
}

export function useTheme(): [ThemeChoice, (choice: ThemeChoice) => void] {
  useEffect(() => {
    const media = window.matchMedia(darkQuery);
    media.addEventListener('change', onSystemChange);
    return () => media.removeEventListener('change', onSystemChange);
  }, []);
  return themePreference.use();
}
