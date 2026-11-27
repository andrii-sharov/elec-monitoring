import { cn } from 'cn';
import type { ComponentProps, CSSProperties, ReactNode } from 'react';
import { Bar as RechartsBar, ResponsiveContainer, Tooltip as RechartsTooltip } from 'recharts';

export { BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';

export type ChartSeries = Record<string, { label: string; color: string }>;

type ChartContainerProps = {
  config: ChartSeries;
  className?: string;
  children: ReactNode;
  initialSize?: { width: number; height: number };
};

function ChartContainer({ config, className, children, initialSize }: ChartContainerProps) {
  const style = Object.fromEntries(
    Object.entries(config).map(([key, series]) => [`--color-${key}`, series.color]),
  ) as CSSProperties;
  return (
    <div
      data-slot="chart"
      style={style}
      className={cn(
        'w-full text-xs select-none',
        '[&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground',
        '[&_.recharts-cartesian-grid_line]:stroke-border',
        '[&_.recharts-cartesian-axis-line]:stroke-border [&_.recharts-cartesian-axis-tick-line]:stroke-border',
        '[&_.recharts-rectangle.recharts-tooltip-cursor]:fill-secondary',
        '[&_.recharts-surface]:outline-none [&_.recharts-wrapper]:outline-none',
        className,
      )}
    >
      <ResponsiveContainer width="100%" height="100%" initialDimension={initialSize}>
        {children}
      </ResponsiveContainer>
    </div>
  );
}

function Bar(props: ComponentProps<typeof RechartsBar>) {
  return <RechartsBar isAnimationActive={false} {...props} />;
}

type ChartTooltipProps<T> = {
  render: (datum: T) => ReactNode;
};

type TooltipPanelProps<T> = ChartTooltipProps<T> & {
  active?: boolean;
  payload?: readonly { payload?: unknown }[];
};

function TooltipPanel<T>({ active, payload, render }: TooltipPanelProps<T>) {
  const datum = payload?.[0]?.payload as T | undefined;
  if (!active || datum === undefined) return null;
  return (
    <div
      data-slot="chart-tooltip"
      className="max-w-72 rounded-md bg-foreground px-2.5 py-1.5 text-xs text-background shadow-md"
    >
      {render(datum)}
    </div>
  );
}

function ChartTooltip<T>({ render }: ChartTooltipProps<T>) {
  return (
    <RechartsTooltip
      isAnimationActive={false}
      cursor={{ className: 'recharts-tooltip-cursor' }}
      content={<TooltipPanel render={render} />}
    />
  );
}

export { Bar, ChartContainer, ChartTooltip, TooltipPanel as ChartTooltipPanel };
