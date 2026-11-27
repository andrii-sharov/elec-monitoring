import { useTranslation } from 'react-i18next';
import { BrandMark } from '@/components/BrandMark';
import { StatusDot } from '@/components/device/StatusMark';
import { useFormatters } from '@/lib/format';
import { useNow } from '@/lib/useNow';
import { cn } from '@/lib/utils';

const hour = 3_600_000;

function Frame({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'flex flex-col gap-4 rounded-xl bg-card p-4 text-card-foreground shadow-(--app-surface-shadow) ring-1 ring-(--app-surface-ring) sm:p-5',
        className,
      )}
    >
      {children}
    </div>
  );
}

const wave = [
  { kind: 'on', from: 0, to: 31 },
  { kind: 'off', from: 31, to: 38 },
  { kind: 'on', from: 38, to: 55 },
  { kind: 'blip', from: 55, to: 55.6 },
  { kind: 'on', from: 55.6, to: 72 },
  { kind: 'net', from: 72, to: 76 },
  { kind: 'on', from: 76, to: 100 },
] as const;

const waveLook = {
  on: 'inset-y-0 border-t-2 border-status-online bg-status-online/10',
  off: 'inset-y-0 border-b-2 border-status-offline bg-status-offline/15',
  net: 'inset-y-0 border-b-2 border-live bg-live/15',
  blip: 'inset-y-0 z-1 bg-warning',
};

export function SquareWave({ className }: { className?: string }) {
  return (
    <div className={cn('relative h-10', className)}>
      {wave.map((segment, index) => (
        <span
          key={segment.from}
          className={cn(
            'absolute',
            waveLook[segment.kind],
            index > 0 &&
              segment.kind !== 'blip' &&
              wave[index - 1]?.kind !== 'blip' &&
              'border-l-2',
          )}
          style={{
            left: `${segment.from}%`,
            width: `max(2px, ${segment.to - segment.from}%)`,
          }}
        />
      ))}
    </div>
  );
}

export function PowerDemo() {
  const { t } = useTranslation();
  const format = useFormatters();
  const now = useNow(1000);
  const since = Math.floor(now / hour) * hour - 2 * hour - 41 * 60_000;
  return (
    <Frame className="w-full max-w-md">
      <div className="flex items-center justify-between">
        <span className="font-heading text-lg font-bold">{t('app.landing.demo.device')}</span>
        <span className="inline-flex h-6 items-center gap-1.5 rounded-full border border-current/30 px-2.5 font-mono text-xs font-medium tracking-wider text-status-online uppercase">
          <StatusDot state="ONLINE" />
          {t('app.state.ONLINE')}
        </span>
      </div>
      <div className="flex flex-col gap-6 rounded-xl bg-signal p-5 text-signal-foreground">
        <p className="flex items-center gap-2 font-mono text-xs font-bold tracking-wider uppercase">
          <StatusDot state="ONLINE" />
          {t('app.power.ONLINE')}
        </p>
        <div className="flex flex-col gap-2">
          <p className="font-heading text-4xl leading-none font-extrabold tracking-tight tabular-nums">
            {format.duration((now - since) / 1000)}
          </p>
          <p className="text-sm text-signal-foreground/75">
            {t('app.device.since', { moment: format.time(new Date(since).toISOString()) })}
          </p>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <p className="font-mono text-xs font-medium tracking-wider text-muted-foreground uppercase">
          {t('app.powerStrip.title')}
        </p>
        <SquareWave />
      </div>
    </Frame>
  );
}

const rows = [
  { cause: 'POWER', kind: 'LONG', minutes: 133, tone: 'bg-status-offline' },
  { cause: 'NETWORK', kind: 'SHORT', minutes: 4, tone: 'bg-live' },
  { cause: 'POWER', kind: 'SHORT', minutes: 2, tone: 'bg-status-offline' },
] as const;

export function HistoryDemo() {
  const { t } = useTranslation();
  const format = useFormatters();
  return (
    <Frame className="w-full">
      <div className="flex flex-col gap-1.5">
        <p className="font-mono text-xs font-medium tracking-wider text-muted-foreground uppercase">
          {t('app.powerStrip.title')}
        </p>
        <SquareWave />
      </div>
      <ul className="flex flex-col divide-y divide-border">
        {rows.map((row) => (
          <li key={`${row.cause}-${row.minutes}`} className="flex items-center gap-3 py-3">
            <span className={cn('size-2 shrink-0 rounded-full', row.tone)} />
            <span className="flex-1 text-sm font-medium">{t(`app.outage.cause.${row.cause}`)}</span>
            <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">
              {t(`app.outage.kind.${row.kind}`)}
            </span>
            <span className="w-24 text-right font-mono text-sm tabular-nums">
              {format.duration(row.minutes * 60)}
            </span>
          </li>
        ))}
        <li className="flex items-center gap-3 py-3">
          <span className="size-2 shrink-0 rounded-full bg-warning" />
          <span className="flex-1 text-sm font-medium">{t('app.outage.type.POWER_BLIP')}</span>
        </li>
      </ul>
    </Frame>
  );
}

function plain(html: string): string {
  return html.replaceAll(/<\/?b>/g, '');
}

export function TelegramDemo() {
  const { t } = useTranslation();
  const format = useFormatters();
  const name = t('app.landing.demo.device');
  const messages = [
    {
      title: plain(t('telegram.offline.title', { name })),
      body: t('telegram.offline.body', { time: '18:42' }),
      time: '18:43',
    },
    {
      title: plain(t('telegram.recovery.title', { name })),
      body: `${t('telegram.recovery.body', { duration: format.duration(133 * 60), range: '18:42 → 20:55' })} · ${t('telegram.cause.POWER')}`,
      time: '20:55',
    },
  ];
  return (
    <div aria-hidden="true" className="flex w-full max-w-md flex-col gap-3">
      {messages.map((message) => (
        <div
          key={message.time}
          className="flex gap-3 rounded-xl bg-card p-4 text-card-foreground shadow-(--app-surface-shadow) ring-1 ring-(--app-surface-ring)"
        >
          <BrandMark className="size-9" />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm font-semibold">{t('common.appName')}</span>
              <span className="font-mono text-xs text-muted-foreground">{message.time}</span>
            </div>
            <p className="text-sm font-semibold">{message.title}</p>
            <p className="text-sm text-muted-foreground">{message.body}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
