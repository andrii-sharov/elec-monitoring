import { screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { meFixture } from '../../test/fixtures.ts';
import { renderInApp } from '../../test/render.tsx';
import { Duration, Moment } from './Moment.tsx';

test('a moment shows the full date with seconds and time zone on hover', async () => {
  const { user } = renderInApp(<Moment iso="2026-11-21T16:42:07Z" />, { me: meFixture() });
  const time = await screen.findByText('21 Nov 18:42');
  expect(time.tagName).toBe('TIME');
  expect(time).toHaveAttribute('datetime', '2026-11-21T16:42:07Z');
  await user.hover(time);
  const tip = await screen.findByText(/18:42:07/);
  expect(tip.textContent).toContain('Saturday');
  expect(tip.textContent).toContain('(Europe/Kyiv)');
});

test('a duration shows the exact value on hover', async () => {
  const { user } = renderInApp(<Duration seconds={6792} />, { me: meFixture() });
  await user.hover(await screen.findByText('1 h 53 min'));
  expect(await screen.findByText('1 h 53 min 12 s')).toBeInTheDocument();
});
