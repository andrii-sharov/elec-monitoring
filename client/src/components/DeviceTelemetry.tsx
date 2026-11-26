import type { Device } from '@elec/shared/api';
import { ChevronDown } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useFormatters } from '@/lib/format';
import { createPreference } from '@/lib/preference';
import { stateStart } from '@/lib/stateStart';
import { useNow } from '@/lib/useNow';
import { cn } from '@/lib/utils';
import { liveTickMs } from './StateDuration';

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
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs tracking-wide uppercase">{label}</dt>
      <dd className="text-foreground">{children}</dd>
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
        {device.last_seen_at
          ? format.since(device.last_seen_at, new Date(now))
          : t('app.device.never')}
      </Detail>
      {rssi === null ? null : (
        <Detail label={t('app.device.details.signal')}>
          {t('app.device.details.dbm', { value: rssi })}
        </Detail>
      )}
      {uptime === null ? null : (
        <Detail label={t('app.device.details.uptime')}>{format.duration(uptime)}</Detail>
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
  const format = useFormatters();
  const now = useNow(liveTickMs);
  const [state, setState] = detailsPreference.use();
  const open = state === 'open';
  const panelId = useId();
  return (
    <div className={cn('flex flex-col gap-2 text-sm text-muted-foreground', className)}>
      <span>
        {t('app.device.since', { moment: format.since(stateStart(device), new Date(now)) })}
      </span>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setState(open ? 'closed' : 'open')}
        className="flex w-fit items-center gap-1 rounded-sm text-xs font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
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
          className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3"
        >
          <Details device={device} now={now} />
        </dl>
      ) : null}
    </div>
  );
}
