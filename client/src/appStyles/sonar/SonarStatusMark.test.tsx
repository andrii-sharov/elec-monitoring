import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createClientI18n } from '@/lib/i18n';
import { SonarStatusMark } from './SonarStatusMark';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

const i18n = createClientI18n('en');
const wrapper = ({ children }: { children: ReactNode }) => (
  <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
);

function dot(container: HTMLElement) {
  return container.querySelector('.sonar-dot');
}

test('a new check-in sends a pulse, the first render does not', () => {
  const { container, rerender, getByText } = render(
    <SonarStatusMark state="ONLINE" lastSeenAt="2026-11-21T16:41:00Z" />,
    { wrapper },
  );
  expect(getByText('Online')).toBeInTheDocument();
  expect(dot(container)).not.toHaveAttribute('data-pulse');
  rerender(<SonarStatusMark state="ONLINE" lastSeenAt="2026-11-21T16:41:30Z" />);
  expect(dot(container)).toHaveAttribute('data-pulse');
});

test('a state change sends a pulse', () => {
  const { container, rerender } = render(
    <SonarStatusMark state="ONLINE" lastSeenAt="2026-11-21T16:41:00Z" />,
    { wrapper },
  );
  rerender(<SonarStatusMark state="OFFLINE" lastSeenAt="2026-11-21T16:41:00Z" />);
  expect(dot(container)).toHaveAttribute('data-pulse');
  expect(dot(container)).toHaveAttribute('data-state', 'OFFLINE');
});
