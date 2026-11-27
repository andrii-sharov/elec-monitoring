import { render } from '@testing-library/react';
import { expect, test } from 'vitest';
import { Bar, BarChart, ChartContainer, ChartTooltipPanel, XAxis } from './chart';

const data = [
  { label: '00', downtime: 10 },
  { label: '01', downtime: 0 },
  { label: '02', downtime: 30 },
];

test('sets a color variable per series and draws bars with it', () => {
  const { container } = render(
    <ChartContainer
      config={{ downtime: { label: 'Downtime', color: 'var(--status-offline)' } }}
      initialSize={{ width: 300, height: 160 }}
    >
      <BarChart data={data} accessibilityLayer={false}>
        <XAxis dataKey="label" />
        <Bar dataKey="downtime" fill="var(--color-downtime)" />
      </BarChart>
    </ChartContainer>,
  );
  const root = container.querySelector<HTMLElement>('[data-slot="chart"]');
  expect(root?.style.getPropertyValue('--color-downtime')).toBe('var(--status-offline)');
  const bars = container.querySelectorAll('.recharts-bar-rectangle path');
  expect(bars.length).toBe(2);
  for (const bar of bars) expect(bar.getAttribute('fill')).toBe('var(--color-downtime)');
});

test('the tooltip panel renders the hovered datum only while active', () => {
  const payload = [{ payload: { label: '02', downtime: 30 } }];
  const show = (datum: { label: string }) => `Hour ${datum.label}`;
  const { rerender, container } = render(
    <ChartTooltipPanel active payload={payload} render={show} />,
  );
  expect(container).toHaveTextContent('Hour 02');
  rerender(<ChartTooltipPanel active={false} payload={payload} render={show} />);
  expect(container).toBeEmptyDOMElement();
});
