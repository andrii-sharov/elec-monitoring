import { Tooltip as TooltipPrimitive } from '@base-ui/react/tooltip';
import { cn } from 'cn';
import { usePopupCollisionPadding } from './bottom-inset';
import type { ReactElement, ReactNode } from 'react';

function TooltipProvider(props: TooltipPrimitive.Provider.Props) {
  return <TooltipPrimitive.Provider delay={300} closeDelay={0} {...props} />;
}

type TooltipProps = {
  content: ReactNode;
  trigger: ReactElement<Record<string, unknown>>;
  children?: ReactNode;
  side?: TooltipPrimitive.Positioner.Props['side'];
  className?: string;
};

function Tooltip({ content, trigger, children, side = 'top', className }: TooltipProps) {
  const collisionPadding = usePopupCollisionPadding();
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger data-slot="tooltip-trigger" render={trigger}>
        {children}
      </TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Positioner
          side={side}
          sideOffset={6}
          collisionPadding={collisionPadding}
          className="isolate z-50"
        >
          <TooltipPrimitive.Popup
            data-slot="tooltip-content"
            className={cn(
              'max-w-72 origin-(--transform-origin) rounded-md bg-foreground px-2.5 py-1.5 text-xs text-background shadow-md transition-[opacity,scale] duration-(--app-panel-duration) data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0',
              className,
            )}
          >
            {content}
          </TooltipPrimitive.Popup>
        </TooltipPrimitive.Positioner>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

export { Tooltip, TooltipProvider };
