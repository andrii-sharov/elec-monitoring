import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { Tabs, TabsList, TabsTab } from './tabs';

afterEach(() => {
  vi.restoreAllMocks();
});

function Sections() {
  return (
    <Tabs defaultValue="profile">
      <TabsList aria-label="Sections">
        {['profile', 'appearance', 'security', 'danger'].map((value) => (
          <TabsTab key={value} value={value}>
            {value}
          </TabsTab>
        ))}
      </TabsList>
    </Tabs>
  );
}

test('line tabs stay on one row and bring the chosen tab into view', async () => {
  const scrolled: Element[] = [];
  Element.prototype.scrollIntoView = vi.fn<(this: Element, arg?: ScrollIntoViewOptions) => void>(
    function () {
      scrolled.push(this);
    },
  );
  render(<Sections />);
  const danger = screen.getByRole('tab', { name: 'danger' });
  expect(danger.className).not.toMatch(/flex-col/);
  await userEvent.click(danger);
  await vi.waitFor(() => expect(scrolled.at(-1)).toBe(danger));
  expect(Element.prototype.scrollIntoView).toHaveBeenLastCalledWith({
    block: 'nearest',
    inline: 'nearest',
  });
});
