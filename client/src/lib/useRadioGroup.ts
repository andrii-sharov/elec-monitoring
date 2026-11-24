import { useRef, type KeyboardEvent } from 'react';

const step: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

export function useRadioGroup<T extends string>(
  values: readonly T[],
  value: T,
  onChange: (next: T) => void,
) {
  const refs = useRef(new Map<T, HTMLElement>());

  function onKeyDown(event: KeyboardEvent) {
    const delta = step[event.key];
    if (delta === undefined) return;
    event.preventDefault();
    const index = values.indexOf(value);
    const next = values[(index + delta + values.length) % values.length];
    if (next === undefined) return;
    onChange(next);
    refs.current.get(next)?.focus();
  }

  function itemProps(item: T) {
    const checked = item === value;
    return {
      role: 'radio' as const,
      'aria-checked': checked,
      tabIndex: checked ? 0 : -1,
      ref: (element: HTMLElement | null) => {
        if (element) refs.current.set(item, element);
        else refs.current.delete(item);
      },
      onClick: () => onChange(item),
      onKeyDown,
    };
  }

  return { itemProps };
}
