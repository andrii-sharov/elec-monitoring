import type { Channel, DeviceListItem } from '@elec/shared/api';
import { useMutation } from '@tanstack/react-query';
import { ChevronDown, CircleAlert, CirclePause, CircleCheck, TriangleAlert } from 'lucide-react';
import { useId, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { deleteChannel, patchChannel, rotateSecret, testChannel } from '@/api/endpoints';
import { isApiError } from '@/api/errors';
import { useSession } from '@/api/session';
import { Tag } from '@/components/OutageTags';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsPanel, TabsTab } from '@/components/ui/tabs';
import { errorMessage } from '@/forms/errorMessage';
import { cn } from '@/lib/utils';
import { ChannelActionsMenu } from './ChannelActionsMenu';
import { channelStatus } from './channelFilters';
import { ChannelOverview } from './ChannelOverview';
import { channelTypeInfo } from './channelTypes';
import { DeliveryLog } from './DeliveryLog';
import { useChannelRefresh } from './useChannelRefresh';
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
  const [editing, setEditing] = useState(false);
  const [panel, setPanel] = useState<'overview' | 'log'>('overview');
  const panelId = useId();
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

  const overview = (
    <ChannelOverview
      key={renaming ? 'renaming' : 'idle'}
      channel={channel}
      devices={devices}
      deviceNames={names}
      renaming={renaming}
      renamePending={rename.isPending}
      onRename={(value) => rename.mutate(value)}
      onRenameCancel={() => setRenaming(false)}
      testPending={test.isPending}
      onTest={() => test.mutate()}
      onEditWebhook={() => {
        setRenaming(false);
        setEditing(true);
      }}
    />
  );

  return (
    <li>
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
            <Tag {...statusTag[status]}>{t(`app.notifications.state.${status}`)}</Tag>
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
          <span className="flex items-center gap-1">
            <Switch
              checked={channel.enabled}
              disabled={toggle.isPending || status === 'failing'}
              onCheckedChange={(value) => toggle.mutate(value)}
              aria-label={t('app.notifications.sendAlerts', { name: channel.name })}
              className="me-1"
            />
            <ChannelActionsMenu
              channel={channel}
              onRename={() => {
                setOpen(true);
                setPanel('overview');
                setRenaming(true);
              }}
              onRotate={() => rotate.mutate()}
              onRemove={() => remove.mutate()}
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
          <div id={panelId} className="border-t border-border p-3">
            {webhook ? (
              <Tabs
                value={panel}
                onValueChange={(value) => setPanel(value as 'overview' | 'log')}
                className="gap-3"
              >
                <TabsList variant="pill">
                  <TabsTab value="overview">{t('app.notifications.overview')}</TabsTab>
                  <TabsTab value="log">{t('app.notifications.webhook.log')}</TabsTab>
                </TabsList>
                <TabsPanel value="overview">{overview}</TabsPanel>
                <TabsPanel value="log">
                  <DeliveryLog channel={channel} devices={devices} />
                </TabsPanel>
              </Tabs>
            ) : (
              <div data-motion="panel">{overview}</div>
            )}
          </div>
        ) : null}
      </div>
      {webhook ? <WebhookForm channel={channel} open={editing} onOpenChange={setEditing} /> : null}
    </li>
  );
}
