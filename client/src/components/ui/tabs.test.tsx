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

const size = (name: string, value: number) =>
  vi.spyOn(HTMLElement.prototype, name as 'offsetLeft', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    if (this.getAttribute('role') === 'tab') return name === 'offsetLeft' ? 300 : 100;
    return value;
  });

test('a tab that starts active is scrolled into the row without moving the page', () => {
  const page = vi.fn<(this: Element, arg?: ScrollIntoViewOptions) => void>();
  Element.prototype.scrollIntoView = page;
  size('offsetLeft', 0);
  size('offsetWidth', 0);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(200);
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(400);
  render(
    <Tabs defaultValue="danger">
      <TabsList aria-label="Sections">
        {['profile', 'danger'].map((value) => (
          <TabsTab key={value} value={value}>
            {value}
          </TabsTab>
        ))}
      </TabsList>
    </Tabs>,
  );
  expect(screen.getByRole('tablist').scrollLeft).toBe(200);
  expect(page).not.toHaveBeenCalled();
});
