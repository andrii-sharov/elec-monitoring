import { readFileSync } from 'node:fs';
import { render } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { expect, test } from 'vitest';
import { createClientI18n } from '../lib/i18n.ts';
import { appStyleIds, appStyles } from './registry.ts';

const ambient = new Set([
  ".sonar-dot[data-state='ONLINE']::after",
  ".sonar-dot[data-state='OFFLINE'][data-size='lg']::after",
  ".sonar-dot[data-state='OFFLINE'][data-size='lg']:not([data-pulse])::before",
]);

const changeMarkers = "[data-snap], [data-pulse], [data-motion='change'], [data-motion='flicker']";

function animatedSelectors(css: string): string[] {
  const selectors: string[] = [];
  let depth = 0;
  let start = 0;
  let selector = '';
  let skip = 0;
  for (let i = 0; i < css.length; i++) {
    const char = css[i];
    if (char === '{') {
      const head = css.slice(start, i).trim();
      if (depth === 0) selector = head;
      if (head.startsWith('@keyframes')) skip = depth + 1;
      depth++;
      start = i + 1;
    } else if (char === '}') {
      const body = css.slice(start, i);
      const animated = /(^|[;\s])animation(-name)?\s*:\s*(?!none)/.test(body);
      if (animated && skip === 0) selectors.push(depth > 1 ? `${selector} ${body}` : selector);
      depth--;
      if (skip > depth) skip = 0;
      start = i + 1;
    }
  }
  return selectors.map((value) => value.replaceAll(/\s+/g, ' ').trim());
}

function styleSheet(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

const sheets = ['../styles.css', ...appStyleIds.map((id) => `./${id}/style.css`)];

test.each(sheets)('%s animates only on a state change, an entrance or an ambient rule', (path) => {
  const offenders = animatedSelectors(styleSheet(path))
    .filter((selector) => !selector.includes('prefers-reduced-motion'))
    .filter((selector) =>
      selector
        .split(',')
        .map((part) => part.trim())
        .some(
          (part) =>
            !part.startsWith('::view-transition') &&
            !/\[data-(motion|pulse|snap)/.test(part) &&
            !ambient.has(part),
        ),
    );
  expect(offenders).toEqual([]);
});

test.each(appStyleIds)('%s status mark plays no change motion on first render', (id) => {
  const { StatusMark } = appStyles[id].slots;
  const { container, rerender } = render(
    <I18nextProvider i18n={createClientI18n('en')}>
      <StatusMark state="ONLINE" lastSeenAt="2026-11-21T18:41:30Z" />
    </I18nextProvider>,
  );
  expect(container.querySelector(changeMarkers)).toBeNull();
  rerender(
    <I18nextProvider i18n={createClientI18n('en')}>
      <StatusMark state="OFFLINE" lastSeenAt="2026-11-21T18:41:30Z" />
    </I18nextProvider>,
  );
  rerender(
    <I18nextProvider i18n={createClientI18n('en')}>
      <StatusMark state="ONLINE" lastSeenAt="2026-11-21T18:41:30Z" />
    </I18nextProvider>,
  );
  expect(container.querySelector(changeMarkers)).not.toBeNull();
});
