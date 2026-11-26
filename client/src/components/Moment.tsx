import type { ReactNode } from 'react';
import { useFormatters } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Tooltip } from './ui/tooltip';

const hint =
  'cursor-help decoration-muted-foreground/50 decoration-dotted underline-offset-4 hover:underline';

export function Moment({
  iso,
  children,
  className,
}: {
  iso: string;
  children?: ReactNode;
  className?: string;
}) {
  const format = useFormatters();
  return (
    <Tooltip
      content={format.full(iso)}
      trigger={<time dateTime={iso} className={cn(hint, className)} />}
    >
      {children ?? format.moment(iso)}
    </Tooltip>
  );
}

export function MomentRange({ from, to }: { from: string; to: string }) {
  const format = useFormatters();
  return (
    <Tooltip
      content={
        <>
          {format.full(from)}
          <br />→ {format.full(to)}
        </>
      }
      trigger={<span className={hint} />}
    >
      {format.range(from, to)}
    </Tooltip>
  );
}

export function Duration({ seconds, className }: { seconds: number; className?: string }) {
  const format = useFormatters();
  return (
    <Tooltip
      content={format.exactDuration(seconds)}
      trigger={<span className={cn(hint, className)} />}
    >
      {format.duration(seconds)}
    </Tooltip>
  );
}
