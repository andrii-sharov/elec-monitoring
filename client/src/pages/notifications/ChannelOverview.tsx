import type { Channel, DeviceListItem } from '@elec/shared/api';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { channelStatus } from './channelFilters';
import { channelTypeInfo } from './channelTypes';
import { EditDevicesDialog } from './EditDevicesDialog';

type Props = {
  channel: Channel;
  devices: DeviceListItem[];
  deviceNames: string[];
  renaming: boolean;
  renamePending: boolean;
  onRename: (name: string) => void;
  onRenameCancel: () => void;
  testPending: boolean;
  onTest: () => void;
  onEditWebhook: () => void;
};

const chipClassName = 'rounded-full bg-secondary px-2 py-0.5 text-xs';

export function ChannelOverview({
  channel,
  devices,
  deviceNames,
  renaming,
  renamePending,
  onRename,
  onRenameCancel,
  testPending,
  onTest,
  onEditWebhook,
}: Props) {
  const { t } = useTranslation();
  const [name, setName] = useState(channel.name);
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (renaming) nameRef.current?.focus();
  }, [renaming]);
  const info = channelTypeInfo[channel.type];
  const summary = info.summary(channel, t);
  const events = 'events' in channel.config ? channel.config.events : [];

  function submitName(event: FormEvent) {
    event.preventDefault();
    if (name.trim()) onRename(name.trim());
  }

  return (
    <div className="flex flex-col gap-3 text-sm">
      {summary ? <p className="break-all text-muted-foreground">{summary}</p> : null}
      {events.length > 0 ? (
        <ul aria-label={t('app.notifications.webhook.events')} className="flex flex-wrap gap-1">
          {events.map((event) => (
            <li key={event} className={chipClassName}>
              {t(`app.notifications.events.${event.replace('device.', '')}`)}
            </li>
          ))}
        </ul>
      ) : null}
      {channelStatus(channel) === 'failing' ? (
        <p className="text-status-offline">{t('app.notifications.failingHint')}</p>
      ) : null}
      {deviceNames.length > 0 ? (
        <ul className="flex flex-wrap gap-1">
          {deviceNames.map((device) => (
            <li key={device} className={chipClassName}>
              {device}
            </li>
          ))}
        </ul>
      ) : null}
      {renaming ? (
        <form onSubmit={submitName} className="flex flex-wrap items-center gap-2 max-sm:*:grow">
          <Input
            aria-label={t('app.notifications.name')}
            value={name}
            maxLength={64}
            ref={nameRef}
            onChange={(event) => setName(event.target.value)}
            className="sm:w-56"
          />
          <Button type="submit" size="sm" disabled={renamePending || !name.trim()}>
            {t('app.common.save')}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={onRenameCancel}>
            {t('app.common.cancel')}
          </Button>
        </form>
      ) : null}
      <div className="flex flex-wrap gap-2 max-sm:*:grow">
        <EditDevicesDialog channel={channel} devices={devices} />
        {info.available ? (
          <Button variant="outline" size="sm" disabled={testPending} onClick={onTest}>
            {t('app.notifications.test')}
          </Button>
        ) : null}
        {channel.type === 'WEBHOOK' ? (
          <Button variant="outline" size="sm" onClick={onEditWebhook}>
            {t('app.notifications.webhook.edit')}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
