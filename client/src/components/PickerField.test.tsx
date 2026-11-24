import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { PickerField } from './PickerField';

const options = [
  { value: 'uk', label: 'Українська' },
  { value: 'en', label: 'English' },
] as const;

test('uses the same trigger, popup and item look as the select', async () => {
  const user = userEvent.setup();
  render(
    <PickerField label="Language" value="uk" options={options} onChange={vi.fn<() => void>()} />,
  );
  const trigger = screen.getByRole('button', { name: /Language/ });
  expect(trigger).toHaveAttribute('data-slot', 'select-trigger');
  await user.click(trigger);
  const item = await screen.findByRole('button', { name: 'English' });
  expect(item).toHaveAttribute('data-slot', 'select-item');
  expect(item.closest('[data-slot="popover-content"]')).toHaveAttribute(
    'data-look',
    'select-content',
  );
});

test('choosing an option reports it', async () => {
  const user = userEvent.setup();
  const onChange = vi.fn<(value: string) => void>();
  render(<PickerField label="Language" value="uk" options={options} onChange={onChange} />);
  await user.click(screen.getByRole('button', { name: /Language/ }));
  await user.click(await screen.findByRole('button', { name: 'English' }));
  expect(onChange).toHaveBeenCalledWith('en');
});
