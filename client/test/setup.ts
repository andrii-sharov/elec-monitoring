import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, vi } from 'vitest';
import { server } from './server.ts';

function noop() {}

function matchMedia(query: string): MediaQueryList {
  return {
    matches: false,
    media: query,
    onchange: null,
    addEventListener: noop,
    removeEventListener: noop,
    addListener: noop,
    removeListener: noop,
    dispatchEvent: () => false,
  };
}

beforeAll(() => {
  vi.stubGlobal('matchMedia', matchMedia);
  server.listen({ onUnhandledFrame: 'error' });
});

beforeEach(() => {
  localStorage.setItem('em.appStyle', 'classic');
});

afterEach(() => {
  cleanup();
  server.resetHandlers();
  localStorage.clear();
  document.documentElement.className = '';
  delete document.documentElement.dataset.appStyle;
});

afterAll(() => {
  server.close();
  vi.unstubAllGlobals();
});
