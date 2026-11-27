import type { Channel, DeviceListItem } from '@elec/shared/api';
import { useMutation } from '@tanstack/react-query';
import { ChevronDown, CircleAlert, CirclePause, CircleCheck, TriangleAlert } from 'lucide-react';
import { useId, useState, type CSSProperties, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { deleteChannel, patchChannel, rotateSecret, testChannel } from '@/api/endpoints';
import { isApiError } from '@/api/errors';
import { useSession } from '@/api/session';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Tag } from '@/components/OutageTags';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { errorMessage } from '@/forms/errorMessage';
import { cn } from '@/lib/utils';
import { channelStatus } from './channelFilters';
import { channelTypeInfo } from './channelTypes';
import { DeliveryLog } from './DeliveryLog';
import { EditDevicesDialog } from './EditDevicesDialog';
import { useChannelRefresh } from './useChannelRefresh';
import { GuideLink } from './WebhookGuideLink';
import { WebhookForm } from './WebhookForm';

const statusTag = {
  active: { icon: CircleCheck, look: 'fill-primary' },
  off: { icon: CirclePause, look: 'dashed' },
  failing: { icon: CircleAlert, look: 'fill-offline' },
} as const;

type Props = {
  channel: Channel;
  devices: DeviceListItem[];
  selected: boolean;
  onSelect: (selected: boolean) => void;
  index: number;
  onSecret: (secret: string) => void;
};

export function ChannelRow({ channel, devices, selected, onSelect, index, onSecret }: Props) {
  const { t } = useTranslation();
  const { api } = useSession();
  const refresh = useChannelRefresh();
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(channel.name);
  const [editing, setEditing] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const panelId = useId();
  const logId = useId();
  const webhook = channel.type === 'WEBHOOK';
  const info = channelTypeInfo[channel.type];
  const Icon = info.icon;
  const status = channelStatus(channel);
  const names = channel.device_ids
    .map((id) => devices.find((device) => device.id === id)?.name)
    .filter((value): value is string => Boolean(value));

  const fail = (error: unknown) => toast.error(errorMessage(t, error));
  const toggle = useMutation({
    mutationFn: (enabled: boolean) => patchChannel(api, channel.id, { enabled }),
    onSuccess: refresh,
    onError: fail,
  });
  const rename = useMutation({
    mutationFn: (value: string) => patchChannel(api, channel.id, { name: value }),
    onSuccess: async () => {
      setRenaming(false);
      toast.success(t('app.notifications.renamed'));
      await refresh();
    },
    onError: fail,
  });
  const test = useMutation({
    mutationFn: () => testChannel(api, channel.id),
    onSuccess: async () => {
      toast.success(t('app.notifications.testSent'));
      await refresh();
    },
    onError: (error) => {
      if (webhook && isApiError(error, 'conflict')) {
        toast.error(t('app.notifications.webhook.testFailed'), {
          description: error.details[0]?.reason,
        });
      } else {
        fail(error);
      }
    },
  });
  const rotate = useMutation({
    mutationFn: async () => {
      const { secret } = await rotateSecret(api, channel.id);
      onSecret(secret);
    },
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: () => deleteChannel(api, channel.id),
    onSuccess: refresh,
    onError: fail,
  });

  function submitName(event: FormEvent) {
    event.preventDefault();
    if (name.trim()) rename.mutate(name.trim());
  }

  return (
    <li className="flex flex-col gap-2">
      <div
        data-motion="enter"
        style={{ '--i': index } as CSSProperties}
        className={cn(
          'rounded-lg border bg-card transition-colors',
          selected ? 'border-primary/60' : 'border-border',
        )}
      >
        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 p-3">
          <Checkbox
            checked={selected}
            onCheckedChange={(value) => onSelect(value)}
            aria-label={t('app.notifications.select', { name: channel.name })}
          />
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
            <span className="flex min-w-0 items-center gap-2">
              <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
              <span className="font-medium break-words">{channel.name}</span>
            </span>
            <Tag {...statusTag[status]}>{t(`app.notifications.status.${status}`)}</Tag>
            {webhook && channel.failures > 0 ? (
              <Tag icon={TriangleAlert} look="outline-offline">
                {t('app.notifications.webhook.failures', { failures: channel.failures })}
              </Tag>
            ) : null}
            <span className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
              {names.length === 0 ? (
                t('app.notifications.noDevices')
              ) : (
                <>
                  {names.slice(0, 3).map((device) => (
                    <span key={device} className="rounded-full bg-secondary px-2 py-0.5">
                      {device}
                    </span>
                  ))}
                  {names.length > 3 ? (
                    <span>{t('app.notifications.moreDevices', { count: names.length - 3 })}</span>
                  ) : null}
                </>
              )}
            </span>
          </div>
          <span className="flex items-center gap-2">
            <Switch
              checked={channel.enabled}
              disabled={toggle.isPending || status === 'failing'}
              onCheckedChange={(value) => toggle.mutate(value)}
              aria-label={t('app.notifications.sendAlerts', { name: channel.name })}
            />
            <Button
              variant="ghost"
              size="icon-sm"
              aria-expanded={open}
              aria-controls={panelId}
              aria-label={t('app.notifications.details', { name: channel.name })}
              onClick={() => setOpen(!open)}
            >
              <ChevronDown
                aria-hidden="true"
                className={cn(
                  'transition-transform duration-(--app-motion-duration)',
                  open && 'rotate-180',
                )}
              />
            </Button>
          </span>
        </div>
        {open ? (
          <div
            id={panelId}
            data-motion="panel"
            className="flex flex-col gap-3 border-t border-border p-3 text-sm"
          >
            {info.summary(channel, t) ? (
              <p className="text-muted-foreground">{info.summary(channel, t)}</p>
            ) : null}
            {webhook ? <GuideLink /> : null}
            {status === 'failing' ? (
              <p className="text-status-offline">{t('app.notifications.failingHint')}</p>
            ) : null}
            {names.length > 0 ? (
              <ul className="flex flex-wrap gap-1">
                {names.map((device) => (
                  <li key={device} className="rounded-full bg-secondary px-2 py-0.5 text-xs">
                    {device}
                  </li>
                ))}
              </ul>
            ) : null}
            {renaming ? (
              <form
                onSubmit={submitName}
                className="flex flex-wrap items-center gap-2 max-sm:*:grow"
              >
                <Input
                  aria-label={t('app.notifications.name')}
                  value={name}
                  maxLength={64}
                  onChange={(event) => setName(event.target.value)}
                  className="sm:w-56"
                />
                <Button type="submit" size="sm" disabled={rename.isPending || !name.trim()}>
                  {t('app.common.save')}
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setRenaming(false)}>
                  {t('app.common.cancel')}
                </Button>
              </form>
            ) : null}
            <div className="flex flex-wrap gap-2 max-sm:*:grow">
              <EditDevicesDialog channel={channel} devices={devices} />
              {webhook ? (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setRenaming(false);
                      setEditing(true);
                    }}
                  >
                    {t('app.notifications.webhook.edit')}
                  </Button>
                  <ConfirmDialog
                    trigger={
                      <Button variant="outline" size="sm" disabled={rotate.isPending}>
                        {t('app.notifications.webhook.rotate')}
                      </Button>
                    }
                    title={t('app.notifications.webhook.rotateTitle')}
                    body={t('app.notifications.webhook.rotateBody')}
                    confirmLabel={t('app.notifications.webhook.rotate')}
                    onConfirm={() => rotate.mutate()}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    aria-expanded={logOpen}
                    aria-controls={logId}
                    onClick={() => setLogOpen(!logOpen)}
                  >
                    {t('app.notifications.webhook.log')}
                  </Button>
                </>
              ) : null}
              {info.available ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={test.isPending}
                  onClick={() => test.mutate()}
                >
                  {t('app.notifications.test')}
                </Button>
              ) : null}
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setName(channel.name);
                  setRenaming(true);
                }}
              >
                {t('app.notifications.rename')}
              </Button>
              <ConfirmDialog
                trigger={
                  <Button variant="outline" size="sm">
                    {t('app.notifications.remove')}
                  </Button>
                }
                title={t('app.notifications.removeTitle')}
                body={t('app.notifications.removeBody')}
                confirmLabel={t('app.notifications.remove')}
                destructive
                onConfirm={() => remove.mutate()}
              />
            </div>
          </div>
        ) : null}
      </div>
      {webhook && open && logOpen ? (
        <DeliveryLog id={logId} channel={channel} devices={devices} />
      ) : null}
      {webhook ? <WebhookForm channel={channel} open={editing} onOpenChange={setEditing} /> : null}
    </li>
  );
}
