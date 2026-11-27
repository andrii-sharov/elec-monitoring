import { Tabs as TabsPrimitive } from '@base-ui/react/tabs';
import { cn } from 'cn';

type Variant = 'line' | 'pill';

export const pillListClassName =
  'relative z-0 flex w-fit items-center gap-0.5 rounded-lg bg-secondary p-0.5';

export const indicatorClassName =
  'absolute left-(--active-tab-left) w-(--active-tab-width) transition-[left,width] duration-(--app-motion-duration) ease-(--app-motion-ease) motion-reduce:transition-none';

export const pillIndicatorClassName =
  'top-(--active-tab-top) -z-1 h-(--active-tab-height) rounded-md bg-card shadow-sm';

export const tabClassName =
  'flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-md px-3.5 py-2 text-sm font-medium compact:min-h-0 compact:px-3 whitespace-nowrap text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 data-active:text-foreground [&_svg]:size-4 [&_svg]:shrink-0';

function Tabs({ className, ...props }: TabsPrimitive.Root.Props) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn('flex flex-col gap-4', className)}
      {...props}
    />
  );
}

function TabsList({
  className,
  variant = 'line',
  children,
  ...props
}: TabsPrimitive.List.Props & { variant?: Variant }) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(
        variant === 'line'
          ? 'relative z-0 flex items-center gap-1 overflow-x-auto border-b border-border'
          : pillListClassName,
        className,
      )}
      {...props}
    >
      {children}
      <TabsPrimitive.Indicator
        data-slot="tabs-indicator"
        className={cn(
          indicatorClassName,
          variant === 'line' ? 'bottom-0 h-0.5 rounded-full bg-primary' : pillIndicatorClassName,
        )}
      />
    </TabsPrimitive.List>
  );
}

function TabsTab({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-tab"
      className={cn(
        tabClassName,
        'in-data-[variant=pill]:min-h-10 in-data-[variant=pill]:py-1.5 compact:in-data-[variant=pill]:min-h-0',
        className,
      )}
      {...props}
    />
  );
}

function TabsPanel({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-panel"
      data-motion="panel"
      className={cn('outline-none', className)}
      {...props}
    />
  );
}

export { Tabs, TabsList, TabsPanel, TabsTab };
