import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { useStateChange } from './useStateChange.ts';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

test('is false on mount', () => {
  const { result } = renderHook(({ value }) => useStateChange(value), {
    initialProps: { value: 'ONLINE' },
  });
  expect(result.current).toBe(false);
});

test('is true after the value changes and false again after the timer', () => {
  const { result, rerender } = renderHook(({ value }) => useStateChange(value, 500), {
    initialProps: { value: 'ONLINE' },
  });
  rerender({ value: 'OFFLINE' });
  expect(result.current).toBe(true);
  act(() => vi.advanceTimersByTime(500));
  expect(result.current).toBe(false);
});

test('a re-render with the same value does not fire', () => {
  const { result, rerender } = renderHook(({ value }) => useStateChange(value), {
    initialProps: { value: 'ONLINE' },
  });
  rerender({ value: 'ONLINE' });
  expect(result.current).toBe(false);
});
