import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select';
import { SortSelect } from './sort-select';

const items = [
  { value: 'all', label: 'Any state' },
  { value: 'failing', label: 'Failing after many retries' },
];

test('a select sized by its labels keeps the width of the widest one', () => {
  render(
    <Select items={items} value="all">
      <SelectTrigger aria-label="State">
        <SelectValue widthOf={items.map((item) => item.label)} />
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>,
  );
  const trigger = screen.getByRole('combobox', { name: 'State' });
  for (const { label } of items) {
    const sizers = [...trigger.querySelectorAll('[aria-hidden="true"]')].filter(
      (node) => node.textContent === label,
    );
    expect(sizers).toHaveLength(1);
  }
});

test('the sort control shows a sort icon and keeps a stable width', () => {
  render(
    <SortSelect
      label="Sort"
      value="name"
      onChange={() => {}}
      options={[
        { value: 'name', label: 'By name' },
        { value: 'devices', label: 'Most devices' },
      ]}
    />,
  );
  const trigger = screen.getByRole('combobox', { name: 'Sort' });
  expect(trigger.querySelector('.lucide-arrow-down-up')).not.toBeNull();
  expect(trigger).toHaveTextContent('By name');
  expect(trigger.querySelector('[data-slot="select-value-stack"]')).not.toBeNull();
});
