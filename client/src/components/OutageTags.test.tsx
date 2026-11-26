import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { expect, test } from 'vitest';
import { outageFixture } from '../../test/fixtures.ts';
import { createClientI18n } from '../lib/i18n.ts';
import { OutageTags } from './OutageTags.tsx';

function renderTags(outage: ReturnType<typeof outageFixture>, showType = true) {
  render(
    <I18nextProvider i18n={createClientI18n('en')}>
      <OutageTags outage={outage} showType={showType} />
    </I18nextProvider>,
  );
}

const look = (text: string) =>
  screen.getByText(text).closest('[data-slot=tag]')?.getAttribute('data-look');

test('cause and kind each get their own look', () => {
  renderTags(outageFixture({ cause: 'NETWORK', kind: 'SHORT' }));
  expect(look('Network outage')).toBe('fill-primary');
  expect(look('Short')).toBe('outline-warning');
});

test('a power blip gets a type tag unless the row already names it', () => {
  renderTags(outageFixture({ type: 'POWER_BLIP', cause: 'POWER', kind: 'LONG' }));
  expect(look('Power blip')).toBe('outline-warning');
  expect(look('Power outage')).toBe('fill-offline');
  expect(look('Long')).toBe('outline-offline');
});

test('an open outage has no cause or kind tags', () => {
  renderTags(outageFixture({ ended_at: null, cause: null, kind: null }), false);
  expect(document.querySelectorAll('[data-slot=tag]')).toHaveLength(0);
});
