import { screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { renderRoute } from '../../test/render.tsx';

test('unknown paths show the translated not-found page', async () => {
  renderRoute('/nowhere');
  expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
});
