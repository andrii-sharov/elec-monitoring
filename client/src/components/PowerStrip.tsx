import { useTranslation } from 'react-i18next';
import { useOutages } from '@/api/queries';
import { useSession } from '@/api/session';
import { Skeleton } from '@/components/ui/skeleton';
import { browserTimezone, useFormatters } from '@/lib/format';
import { buildPowerStrip, type StripSegment } from '@/lib/powerStrip';
import { useNow } from '@/lib/useNow';
import { cn } from '@/lib/utils';

const day = 86_400_000;
const windowMs = 7 * day;

const segmentColor: Record<StripSegment['kind'], string> = {
  on: 'bg-status-online',
  outage: 'bg-status-offline',
  blip: 'bg-warning',
  unknown: 'bg-secondary',
};

function Segment({ segment, from }: { segment: StripSegment; from: number }) {
  const { t } = useTranslation();
  const format = useFormatters();
  const label = `${t(`app.powerStrip.kind.${segment.kind}`)}: ${format.range(
    new Date(segment.start).toISOString(),
    new Date(segment.end).toISOString(),
  )}`;
  const width = ((segment.end - segment.start) / windowMs) * 100;
  const left = ((segment.start - from) / windowMs) * 100;
  return (
    <button
      type="button"
      aria-label={label}
      className={cn(
        'group/segment absolute inset-y-0 cursor-default outline-none focus-visible:z-10 focus-visible:ring-3 focus-visible:ring-ring/50',
        segment.kind === 'blip' ? 'z-1 min-w-1' : '',
        segmentColor[segment.kind],
      )}
      style={{ left: `${left}%`, width: `${width}%` }}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 hidden -translate-x-1/2 rounded-md bg-foreground px-2 py-1 text-xs whitespace-nowrap text-background group-hover/segment:block group-focus-visible/segment:block"
      >
        {label}
      </span>
    </button>
  );
}

function dayTicks(from: number, timezone: string, language: string) {
  const weekday = new Intl.DateTimeFormat(language, { weekday: 'short', timeZone: timezone });
  return Array.from({ length: 7 }, (_, i) => {
    const at = from + (i + 0.5) * day;
    return { left: ((i + 0.5) / 7) * 100, label: weekday.format(at) };
  });
}

export function PowerStrip({ deviceId, className }: { deviceId: string; className?: string }) {
  const { t, i18n } = useTranslation();
  const { me } = useSession();
  const outages = useOutages(deviceId);
  const now = useNow(60_000);

  if (!outages.data) return <Skeleton className={cn('h-10', className)} />;

  const items = outages.data.pages.flatMap((page) => page.items);
  const segments = buildPowerStrip({
    outages: items,
    now,
    windowMs,
    complete: !outages.hasNextPage,
  });
  const from = now - windowMs;
  const count = (kind: StripSegment['kind']) => segments.filter((s) => s.kind === kind).length;
  const timezone = me?.timezone ?? browserTimezone();

  return (
    <figure className={cn('flex flex-col gap-1.5', className)}>
      <figcaption className="text-xs font-medium text-muted-foreground">
        <span aria-hidden="true">{t('app.powerStrip.title')}</span>
        <span className="sr-only">
          {t('app.powerStrip.summary', { outages: count('outage'), blips: count('blip') })}
        </span>
      </figcaption>
      <div className="relative h-4 rounded-sm bg-secondary">
        {segments.map((segment) => (
          <Segment key={`${segment.kind}-${segment.start}`} segment={segment} from={from} />
        ))}
      </div>
      <div aria-hidden="true" className="relative h-5 text-xs text-muted-foreground">
        {dayTicks(from, timezone, i18n.resolvedLanguage ?? 'en').map((tick) => (
          <span
            key={tick.left}
            className="absolute -translate-x-1/2"
            style={{ left: `${tick.left}%` }}
          >
            {tick.label}
          </span>
        ))}
      </div>
    </figure>
  );
}
