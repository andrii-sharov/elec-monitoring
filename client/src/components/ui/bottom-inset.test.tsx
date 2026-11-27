import { render, renderHook, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { expect, test } from 'vitest';
import { BottomInsetProvider, fixedBottomInset, usePopupCollisionPadding } from './bottom-inset';
import { Popover, PopoverContent, PopoverTrigger } from './popover';

test('popups keep 8 px from every edge without a bottom nav', () => {
  const { result } = renderHook(() => usePopupCollisionPadding());
  expect(result.current).toEqual({ top: 8, right: 8, bottom: 8, left: 8 });
});

const navInset = ({ children }: { children: ReactNode }) => (
  <BottomInsetProvider value={64}>{children}</BottomInsetProvider>
);

test('popups stop above the bottom nav', () => {
  const { result } = renderHook(() => usePopupCollisionPadding(), { wrapper: navInset });
  expect(result.current.bottom).toBe(72);
});

test('a nav that is not fixed leaves no inset', () => {
  const nav = document.body.appendChild(document.createElement('nav'));
  nav.style.position = 'static';
  expect(fixedBottomInset(nav)).toBe(0);
  nav.style.position = 'fixed';
  nav.getBoundingClientRect = () => ({ height: 64 }) as DOMRect;
  expect(fixedBottomInset(nav)).toBe(64);
  nav.remove();
});

test('a popover never grows past the space it has', () => {
  render(
    <Popover open>
      <PopoverTrigger>Open</PopoverTrigger>
      <PopoverContent>Body</PopoverContent>
    </Popover>,
  );
  expect(screen.getByText('Body').closest('[data-slot="popover-content"]')).toHaveClass(
    'max-h-(--available-height)',
  );
});
