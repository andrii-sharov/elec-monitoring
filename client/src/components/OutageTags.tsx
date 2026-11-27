import type { OutageItem } from '@elec/shared/api';
import { CircleHelp, Hourglass, Timer, Unplug, WifiOff, Zap, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

type Look = 'outline-warning' | 'outline-offline' | 'fill-offline' | 'fill-live' | 'dashed';

const looks: Record<Look, string> = {
  'outline-warning': 'border-warning/70 text-warning',
  'outline-offline': 'border-status-offline/70 text-status-offline',
  'fill-offline':
    'border-transparent bg-[color-mix(in_oklab,var(--status-offline)_14%,transparent)] text-status-offline',
  'fill-live': 'border-transparent bg-[color-mix(in_oklab,var(--live)_14%,transparent)] text-live',
  dashed: 'border-dashed border-muted-foreground/60 text-muted-foreground',
};

export function Tag({
  icon: Icon,
  look,
  children,
}: {
  icon: LucideIcon;
  look: Look;
  children: ReactNode;
}) {
  return (
    <span
      data-slot="tag"
      data-look={look}
      className={cn(
        'inline-flex h-5.5 items-center gap-1 rounded-full border px-2 text-xs leading-none font-medium whitespace-nowrap',
        looks[look],
      )}
    >
      <Icon aria-hidden="true" className="size-3" />
      {children}
    </span>
  );
}

const kindTag = {
  SHORT: { icon: Timer, look: 'outline-warning' },
  LONG: { icon: Hourglass, look: 'outline-offline' },
} as const;

const causeTag = {
  POWER: { icon: Unplug, look: 'fill-offline' },
  NETWORK: { icon: WifiOff, look: 'fill-live' },
  UNKNOWN: { icon: CircleHelp, look: 'dashed' },
} as const;

export function OutageTags({
  outage,
  showType = true,
  className,
}: {
  outage: OutageItem;
  showType?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <span className={cn('flex flex-wrap items-center gap-1.5', className)}>
      {showType && outage.type === 'POWER_BLIP' ? (
        <Tag icon={Zap} look="outline-warning">
          {t('app.outage.type.POWER_BLIP')}
        </Tag>
      ) : null}
      {outage.cause ? (
        <Tag {...causeTag[outage.cause]}>{t(`app.outage.cause.${outage.cause}`)}</Tag>
      ) : null}
      {outage.kind ? (
        <Tag {...kindTag[outage.kind]}>{t(`app.outage.kind.${outage.kind}`)}</Tag>
      ) : null}
    </span>
  );
}
