import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, expect, test, vi } from 'vitest';
import { createClientI18n } from '../lib/i18n.ts';
import { PromoVideo } from './PromoVideo.tsx';

function stubMotion(reduce: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduce && query.includes('reduce'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

function renderVideo(language: 'en' | 'uk') {
  render(
    <I18nextProvider i18n={createClientI18n(language)}>
      <PromoVideo />
    </I18nextProvider>,
  );
  return screen.getByLabelText(/Electricity Monitor|Монітор електрики/) as HTMLVideoElement;
}

afterEach(() => {
  stubMotion(false);
});

test('autoplays muted in a loop, in the UI language', () => {
  stubMotion(false);
  const video = renderVideo('uk');
  expect(video.autoplay).toBe(true);
  expect(video.muted).toBe(true);
  expect(video.loop).toBe(true);
  expect(video.controls).toBe(false);
  expect(video.getAttribute('src')).toContain('hero-uk');
});

test('stays still with controls under reduced motion', () => {
  stubMotion(true);
  const video = renderVideo('en');
  expect(video.autoplay).toBe(false);
  expect(video.controls).toBe(true);
  expect(video.preload).toBe('none');
  expect(video.getAttribute('src')).toContain('hero-en');
});
