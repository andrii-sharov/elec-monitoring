import { createContext, useContext, useEffect, useState, type RefObject } from 'react';

const EDGE = 8;

const BottomInsetContext = createContext(0);

export const BottomInsetProvider = BottomInsetContext.Provider;

export function usePopupCollisionPadding() {
  const inset = useContext(BottomInsetContext);
  return { top: EDGE, right: EDGE, bottom: EDGE + inset, left: EDGE };
}

export function fixedBottomInset(element: HTMLElement): number {
  if (getComputedStyle(element).position !== 'fixed') return 0;
  return element.getBoundingClientRect().height;
}

export function useFixedBottomInset(ref: RefObject<HTMLElement | null>): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setInset(fixedBottomInset(element));
    measure();
    const resized = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    resized?.observe(element);
    window.addEventListener('resize', measure);
    return () => {
      resized?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [ref]);
  return inset;
}
