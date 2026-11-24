import type { DeviceListItem } from '@elec/shared/api';
import { Check } from 'lucide-react';
import { useEffect, useId, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { AppStyleProvider, useAppStyle } from '@/appStyles/AppStyleProvider';
import { appStyleIds, appStyles, type AppStyleId } from '@/appStyles/registry';
import { useRadioGroup } from '@/lib/useRadioGroup';
import { cn } from '@/lib/utils';

const settings: DeviceListItem['settings'] = {
  ping_interval_s: 30,
  offline_timeout_s: 120,
  short_outage_threshold_s: 180,
  notify_short_outages: true,
  notify_network_outages: true,
  quiet_hours: null,
  auto_update: false,
};

function sampleDevices(now: number): DeviceListItem[] {
  return [
    {
      id: 'preview-home',
      name: 'Home',
      role: 'OWNER',
      state: 'ONLINE',
      state_since: new Date(now - 3 * 3_600_000 - 12 * 60_000).toISOString(),
      last_seen_at: new Date(now).toISOString(),
      open_outage: null,
      settings,
    },
    {
      id: 'preview-garage',
      name: 'Garage',
      role: 'OWNER',
      state: 'OFFLINE',
      state_since: new Date(now - 25 * 60_000).toISOString(),
      last_seen_at: new Date(now - 27 * 60_000).toISOString(),
      open_outage: null,
      settings,
    },
  ];
}

function StylePreviewList() {
  const style = useAppStyle();
  const { DeviceSummary } = style.slots;
  const [devices] = useState(() => sampleDevices(Date.now()));
  return (
    <ul className={style.deviceListClassName}>
      {devices.map((device, index) => (
        <li key={device.id}>
          <DeviceSummary device={device} index={index} />
        </li>
      ))}
    </ul>
  );
}

export function AppStylePreview({ id, className }: { id: AppStyleId; className?: string }) {
  return (
    <AppStyleProvider id={id}>
      <div
        data-app-style={id}
        aria-hidden="true"
        inert
        className={cn('pointer-events-none overflow-hidden', className)}
        style={{ background: 'var(--app-backdrop)', color: 'var(--foreground)' }}
      >
        <div className="w-[30rem] p-3 [zoom:0.55]">
          <StylePreviewList />
        </div>
      </div>
    </AppStyleProvider>
  );
}

type AppStylePickerProps = {
  value: AppStyleId;
  onChange(next: AppStyleId): void;
  label: string;
};

export function AppStylePicker({ value, onChange, label }: AppStylePickerProps) {
  const { t } = useTranslation();
  const baseId = useId();
  const { itemProps } = useRadioGroup(appStyleIds, value, onChange);

  useEffect(() => {
    for (const id of appStyleIds) void appStyles[id].loadFonts();
  }, []);

  return (
    <div role="radiogroup" aria-label={label} className="grid gap-3 sm:grid-cols-2">
      {appStyleIds.map((id, index) => {
        const checked = id === value;
        return (
          <div
            key={id}
            {...itemProps(id)}
            aria-labelledby={`${baseId}-${id}-name`}
            aria-describedby={`${baseId}-${id}-description`}
            data-motion="enter"
            style={{ '--i': index } as CSSProperties}
            className={cn(
              'group/option relative flex cursor-pointer flex-col overflow-hidden rounded-xl bg-card text-card-foreground ring-1 ring-border transition-shadow outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
              checked && 'ring-2 ring-primary',
            )}
          >
            <AppStylePreview id={id} className="h-36 border-b border-border" />
            <div className="flex items-start gap-2 p-3">
              <div className="flex flex-1 flex-col gap-0.5">
                <span id={`${baseId}-${id}-name`} className="font-medium">
                  {t(`app.appStyle.${id}.name`)}
                </span>
                <span id={`${baseId}-${id}-description`} className="text-sm text-muted-foreground">
                  {t(`app.appStyle.${id}.description`)}
                </span>
              </div>
              <span
                aria-hidden="true"
                className={cn(
                  'flex size-5 flex-none items-center justify-center rounded-full border border-input',
                  checked && 'border-primary bg-primary text-primary-foreground',
                )}
              >
                {checked ? <Check className="size-3.5" /> : null}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
