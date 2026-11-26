import { cn } from 'cn';
import { useLayoutEffect, useRef, useState, type ComponentProps, type CSSProperties } from 'react';
import {
  indicatorClassName,
  pillIndicatorClassName,
  pillListClassName,
  tabClassName,
} from './tabs';

export const segmentClassName = cn(tabClassName, 'py-1.5 aria-pressed:text-foreground');

type Box = { left: number; top: number; width: number; height: number };

function sameBox(a: Box | null, b: Box | null): boolean {
  return (
    a === b ||
    (!!a &&
      !!b &&
      a.left === b.left &&
      a.top === b.top &&
      a.width === b.width &&
      a.height === b.height)
  );
}

function pressedBox(list: HTMLElement): Box | null {
  const pressed = list.querySelector<HTMLElement>('[aria-pressed="true"]');
  if (!pressed) return null;
  return {
    left: pressed.offsetLeft,
    top: pressed.offsetTop,
    width: pressed.offsetWidth,
    height: pressed.offsetHeight,
  };
}

type SegmentedControlProps = ComponentProps<'fieldset'> & { label: string };

function SegmentedControl({ label, className, children, ...props }: SegmentedControlProps) {
  const ref = useRef<HTMLFieldSetElement>(null);
  const [box, setBox] = useState<Box | null>(null);

  useLayoutEffect(() => {
    const list = ref.current;
    if (!list) return;
    const measure = () => {
      const next = pressedBox(list);
      setBox((current) => (sameBox(current, next) ? current : next));
    };
    measure();
    const pressed = new MutationObserver(measure);
    pressed.observe(list, { subtree: true, attributeFilter: ['aria-pressed'] });
    const resized = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    resized?.observe(list);
    return () => {
      pressed.disconnect();
      resized?.disconnect();
    };
  }, []);

  return (
    <fieldset
      ref={ref}
      data-slot="segmented-control"
      className={cn(pillListClassName, 'flex-wrap', className)}
      {...props}
    >
      <legend className="sr-only">{label}</legend>
      {children}
      {box ? (
        <span
          aria-hidden="true"
          data-slot="segmented-indicator"
          className={cn(indicatorClassName, pillIndicatorClassName)}
          style={
            {
              '--active-tab-left': `${box.left}px`,
              '--active-tab-top': `${box.top}px`,
              '--active-tab-width': `${box.width}px`,
              '--active-tab-height': `${box.height}px`,
            } as CSSProperties
          }
        />
      ) : null}
    </fieldset>
  );
}

function Segment({ className, ...props }: ComponentProps<'button'>) {
  return (
    <button
      type="button"
      data-slot="segment"
      className={cn(segmentClassName, className)}
      {...props}
    />
  );
}

export { Segment, SegmentedControl };
