import { render, screen, waitFor } from '@testing-library/react';
import { expect, test } from 'vitest';
import { Segment, SegmentedControl } from './segmented-control';

function Periods({ pressed }: { pressed: string | null }) {
  return (
    <SegmentedControl label="Period">
      {['Day', 'Week'].map((name) => (
        <Segment key={name} aria-pressed={pressed === name}>
          {name}
        </Segment>
      ))}
    </SegmentedControl>
  );
}

const indicator = () => document.querySelector('[data-slot="segmented-indicator"]');

test('shows the sliding indicator only while a segment is pressed', async () => {
  const { rerender } = render(<Periods pressed={null} />);
  expect(screen.getByRole('group', { name: 'Period' })).toBeInTheDocument();
  expect(indicator()).toBeNull();
  rerender(<Periods pressed="Week" />);
  await waitFor(() => expect(indicator()).not.toBeNull());
});
