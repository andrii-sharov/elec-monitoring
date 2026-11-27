import type { Device } from '@elec/shared/api';
import { ChevronDown } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useFormatters } from '@/lib/format';
import { createPreference } from '@/lib/preference';
import { useNow } from '@/lib/useNow';
import { cn } from '@/lib/utils';
import { liveTickMs } from './StateDuration';
import { Duration, Moment } from './Moment';

const detailsPreference = createPreference({
  key: 'em.deviceDetails',
  choices: ['closed', 'open'] as const,
  fallback: 'closed',
  apply: () => {},
});

function liveUptime(device: Device, now: number): number | null {
  const { uptime_s: uptime } = device.telemetry;
  if (uptime === null || device.state !== 'ONLINE' || !device.last_seen_at) return uptime;
  return uptime + Math.max(0, (now - new Date(device.last_seen_at).getTime()) / 1000);
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 sm:flex-col sm:justify-start sm:gap-0.5">
      <dt className="shrink-0 sm:text-xs sm:tracking-wide sm:uppercase">{label}</dt>
      <dd className="text-right text-foreground sm:text-left">{children}</dd>
    </div>
  );
}

function Details({ device, now }: { device: Device; now: number }) {
  const { t } = useTranslation();
  const format = useFormatters();
  const { rssi, reset_reason: resetReason } = device.telemetry;
  const uptime = liveUptime(device, now);
  const sync = device.settings_sync;
  return (
    <>
      <Detail label={t('app.device.details.lastSeen')}>
        {device.last_seen_at ? (
          <Moment iso={device.last_seen_at}>
            {format.since(device.last_seen_at, new Date(now))}
          </Moment>
        ) : (
          t('app.device.never')
        )}
      </Detail>
      {rssi === null ? null : (
        <Detail label={t('app.device.details.signal')}>
          {t('app.device.details.dbm', { value: rssi })}
        </Detail>
      )}
      {uptime === null ? null : (
        <Detail label={t('app.device.details.uptime')}>
          <Duration seconds={uptime} />
        </Detail>
      )}
      {resetReason === null ? null : (
        <Detail label={t('app.device.details.resetReason')}>
          {t(`app.device.resetReason.${resetReason}`)}
        </Detail>
      )}
      {device.firmware.version === null ? null : (
        <Detail label={t('app.device.details.firmware')}>{device.firmware.version}</Detail>
      )}
      <Detail label={t('app.device.details.settings')}>
        {sync.pending ? t('app.settings.pending') : t('app.device.details.settingsApplied')}
      </Detail>
    </>
  );
}

export function DeviceTelemetry({ device, className }: { device: Device; className?: string }) {
  const { t } = useTranslation();
  const now = useNow(liveTickMs);
  const [state, setState] = detailsPreference.use();
  const open = state === 'open';
  const panelId = useId();
  return (
    <div className={cn('flex flex-col gap-2 text-sm text-muted-foreground', className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setState(open ? 'closed' : 'open')}
        className="flex min-h-10 w-fit items-center gap-1 rounded-sm text-xs font-medium text-primary compact:min-h-0 underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {open ? t('app.device.details.hide') : t('app.device.details.show')}
        <ChevronDown
          aria-hidden="true"
          className={cn(
            'size-3.5 transition-transform duration-(--app-motion-duration)',
            open && 'rotate-180',
          )}
        />
      </button>
      {open ? (
        <dl
          id={panelId}
          data-motion="panel"
          className="grid gap-y-2.5 sm:grid-cols-3 sm:gap-x-6 sm:gap-y-2"
        >
          <Details device={device} now={now} />
        </dl>
      ) : null}
    </div>
  );
}
