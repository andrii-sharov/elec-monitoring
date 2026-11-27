import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" className={cn('shrink-0', className)}>
      <rect width="64" height="64" rx="14" fill="#151E27" />
      <rect
        x="1"
        y="1"
        width="62"
        height="62"
        rx="13"
        fill="none"
        stroke="#2A3742"
        strokeWidth="2"
      />
      <path
        d="M8 40 H20 V22 H38 V40 H46 V22 H52"
        fill="none"
        stroke="#C8F560"
        strokeWidth="4.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="52" cy="22" r="4.5" fill="#5CE1E6" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  const { t } = useTranslation();
  const [first, ...rest] = t('common.appName').split(' ');
  return (
    <span className={cn('font-heading font-bold tracking-tight max-[22.5rem]:sr-only', className)}>
      {first} <span className="text-primary">{rest.join(' ')}</span>
      <span aria-hidden="true" className="text-live">
        _
      </span>
    </span>
  );
}
