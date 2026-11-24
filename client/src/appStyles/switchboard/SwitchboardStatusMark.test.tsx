import type { DeviceState } from '@elec/shared';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { expect, test } from 'vitest';
import { createClientI18n } from '@/lib/i18n';
import { SwitchboardStatusMark } from './SwitchboardStatusMark';

const i18n = createClientI18n('en');
const wrapper = ({ children }: { children: ReactNode }) => (
  <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
);

test.each<[DeviceState, string, string]>([
  ['ONLINE', 'up', 'Online'],
  ['OFFLINE', 'down', 'Offline'],
  ['PENDING', 'middle', 'Pending'],
  ['UPDATING', 'middle', 'Updating'],
])('%s puts the lever %s and keeps the state text', (state, position, text) => {
  const { container, getByText } = render(<SwitchboardStatusMark state={state} />, { wrapper });
  expect(container.querySelector('.switchboard-lever')).toHaveAttribute('data-position', position);
  expect(getByText(text)).toBeInTheDocument();
});

test('a state change snaps the lever once', () => {
  const { container, rerender } = render(<SwitchboardStatusMark state="ONLINE" />, { wrapper });
  expect(container.querySelector('.switchboard-lever')).not.toHaveAttribute('data-snap');
  rerender(<SwitchboardStatusMark state="OFFLINE" />);
  expect(container.querySelector('.switchboard-lever')).toHaveAttribute('data-snap');
});
