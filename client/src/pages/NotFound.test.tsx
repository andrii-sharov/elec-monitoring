import { screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { renderRoute } from '../../test/render.tsx';

test('unknown paths show the translated not-found page', async () => {
  renderRoute('/nowhere');
  expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
});

test('the illustration is inline so it follows the theme, and hidden from screen readers', async () => {
  renderRoute('/nowhere');
  await screen.findByRole('heading', { name: 'Page not found' });
  const art = document.querySelector('[data-illustration="notFound"]');
  expect(art).toHaveAttribute('aria-hidden', 'true');
  expect(art?.querySelector('svg.em-ill')).not.toBeNull();
  expect(screen.queryByRole('img')).toBeNull();
});
