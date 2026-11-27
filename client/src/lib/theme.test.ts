import { afterEach, describe, expect, test } from 'vitest';
import { applyTheme, readTheme } from './theme.ts';

const html = document.documentElement;

afterEach(() => {
  html.classList.remove('dark');
});

describe('applyTheme', () => {
  test('dark choice sets the dark class', () => {
    applyTheme('dark', false);
    expect(html).toHaveClass('dark');
  });

  test('system choice follows a dark preference', () => {
    applyTheme('system', true);
    expect(html).toHaveClass('dark');
  });

  test('light choice ignores a dark preference', () => {
    html.classList.add('dark');
    applyTheme('light', true);
    expect(html).not.toHaveClass('dark');
  });
});

describe('readTheme', () => {
  test('defaults to dark', () => {
    expect(readTheme()).toBe('dark');
  });

  test('reads a stored choice and ignores unknown values', () => {
    localStorage.setItem('em.theme', 'dark');
    expect(readTheme()).toBe('dark');
    localStorage.setItem('em.theme', 'sepia');
    expect(readTheme()).toBe('dark');
  });
});
