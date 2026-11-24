import { act, renderHook } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { createPreference } from './preference.ts';

const choices = ['red', 'green', 'blue'] as const;

function makePreference() {
  const apply = vi.fn<(value: string) => void>();
  const preference = createPreference({ key: 'test.color', choices, fallback: 'red', apply });
  return { preference, apply };
}

describe('createPreference', () => {
  test('missing value reads as the fallback', () => {
    expect(makePreference().preference.read()).toBe('red');
  });

  test('unknown stored value reads as the fallback', () => {
    localStorage.setItem('test.color', 'purple');
    expect(makePreference().preference.read()).toBe('red');
  });

  test('reads a stored choice', () => {
    localStorage.setItem('test.color', 'blue');
    expect(makePreference().preference.read()).toBe('blue');
  });

  test('write stores the value and applies it', () => {
    const { preference, apply } = makePreference();
    preference.write('green');
    expect(localStorage.getItem('test.color')).toBe('green');
    expect(apply).toHaveBeenCalledWith('green');
  });

  test('write re-renders subscribers', () => {
    const { preference } = makePreference();
    const { result } = renderHook(() => preference.use());
    expect(result.current[0]).toBe('red');
    act(() => result.current[1]('blue'));
    expect(result.current[0]).toBe('blue');
  });
});
