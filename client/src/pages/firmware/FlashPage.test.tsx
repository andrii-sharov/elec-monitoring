import { screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { meFixture } from '../../../test/fixtures.ts';
import { renderRoute } from '../../../test/render.tsx';
import { loadInstallButton } from './loadInstallButton.ts';

vi.mock('./loadInstallButton.ts', () => ({ loadInstallButton: vi.fn(() => Promise.resolve()) }));

afterEach(() => {
  Reflect.deleteProperty(navigator, 'serial');
  vi.mocked(loadInstallButton).mockClear();
});

test('without Web Serial it explains which browser to use and loads nothing', async () => {
  renderRoute('/flash', { me: meFixture() });
  expect(await screen.findByRole('heading', { name: 'Flash firmware' })).toBeInTheDocument();
  expect(
    screen.getByText('Use Chrome or Edge on a computer to flash firmware.'),
  ).toBeInTheDocument();
  expect(document.querySelector('esp-web-install-button')).toBeNull();
  expect(loadInstallButton).not.toHaveBeenCalled();
});

test('with Web Serial it loads ESP Web Tools and points it at the manifest', async () => {
  Object.defineProperty(navigator, 'serial', { value: {}, configurable: true });
  renderRoute('/flash', { me: meFixture() });
  expect(await screen.findByRole('heading', { name: 'Flash firmware' })).toBeInTheDocument();
  const element = document.querySelector('esp-web-install-button');
  expect(element).toHaveAttribute(
    'manifest',
    'http://localhost:3000/api/v1/firmware/manifest.json',
  );
  expect(screen.getByRole('button', { name: 'Install' })).toHaveAttribute('slot', 'activate');
  expect(loadInstallButton).toHaveBeenCalled();
});

test('lists the steps', async () => {
  renderRoute('/flash', { me: meFixture() });
  expect(
    await screen.findByText('Plug the board in with a USB cable that carries data.'),
  ).toBeInTheDocument();
  expect(screen.getByText(/ElecMonitor-XXXX/)).toBeInTheDocument();
});
