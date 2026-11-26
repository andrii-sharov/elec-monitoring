import { useId } from 'react';
import { cn } from '@/lib/utils';

const bolt = 'M36 9 L23 36 H32 L28 55 L43 27 H34 Z';

export function BrandMark({ className }: { className?: string }) {
  const id = `brand${useId().replace(/[^\w-]/g, '')}`;
  const gradient = `${id}-bg`;
  const gap = `${id}-gap`;
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" className={cn('shrink-0', className)}>
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1D78A8" />
          <stop offset="1" stopColor="#0F4664" />
        </linearGradient>
        <mask id={gap} maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64">
          <rect width="64" height="64" fill="#fff" />
          <path d={bolt} fill="#000" stroke="#000" strokeWidth="6" strokeLinejoin="round" />
        </mask>
      </defs>
      <rect width="64" height="64" rx="15" fill={`url(#${gradient})`} />
      <g mask={`url(#${gap})`} fill="none" stroke="#92CBE6" strokeWidth="4" strokeLinecap="round">
        <path d="M6 34 H10 L14.5 27.5 L19 34 H30" strokeLinejoin="round" />
        <path d="M34 34 H58" />
      </g>
      <path d={bolt} fill="#F1C677" stroke="#F1C677" strokeWidth="2.5" strokeLinejoin="round" />
      <circle cx="51" cy="13" r="4.5" fill="#79DEB2" />
    </svg>
  );
}
