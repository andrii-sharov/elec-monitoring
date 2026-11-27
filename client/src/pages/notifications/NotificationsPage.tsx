import type { ChannelType } from '@elec/shared';
import type { Channel } from '@elec/shared/api';
import { useMutation } from '@tanstack/react-query';
import { BellRing, Plus, RotateCw, Search } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { deleteChannel, patchChannel } from '@/api/endpoints';
import { useChannels, useDevices } from '@/api/queries';
import { useSession } from '@/api/session';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { SortSelect } from '@/components/ui/sort-select';
import { errorMessage } from '@/forms/errorMessage';
import { ChannelRow } from './ChannelRow';
import {
  channelStatus,
  filterChannels,
  filterParams,
  readFilters,
  sorts,
  statuses,
} from './channelFilters';
import { addableTypes, channelTypeInfo } from './channelTypes';
import { DevicesDialogContent } from './EditDevicesDialog';
import { TelegramConnect } from './TelegramConnect';
import { useChannelRefresh } from './useChannelRefresh';
import { WebhookForm } from './WebhookForm';
import { GuideLink } from './WebhookGuideLink';
import { WebhookSecretDialog } from './WebhookSecretDialog';
import { EmptyState } from '@/components/Illustration';

type Option = { value: string; label: string };

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Option[];
  onChange: (value: string) => void;
}) {
  return (
    <Select items={options} value={value} onValueChange={(next) => next && onChange(next)}>
      <SelectTrigger aria-label={label} className="max-sm:w-full">
        <SelectValue widthOf={options.map((option) => option.label)} />
      </SelectTrigger>
      <SelectContent align="start">
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function AddChannelMenu({ onAdd }: { onAdd: (type: ChannelType) => void }) {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button>
            <Plus aria-hidden="true" />
            {t('app.notifications.add')}
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="min-w-48">
        {addableTypes.map((type) => {
          const { icon: Icon, available } = channelTypeInfo[type];
          return (
            <DropdownMenuItem key={type} disabled={!available} onClick={() => onAdd(type)}>
              <Icon aria-hidden="true" />
              {t(`app.channel.type.${type}`)}
              {available ? null : (
                <span className="ms-auto text-xs text-muted-foreground">
                  {t('app.notifications.comingSoon')}
                </span>
              )}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function NotificationsPage() {
  const { t } = useTranslation();
  const { api } = useSession();
  const refresh = useChannelRefresh();
  const channels = useChannels();
  const devices = useDevices();
  const [params, setParams] = useSearchParams();
  const filters = readFilters(params);
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [addingWebhook, setAddingWebhook] = useState(false);
  const [reveal, setReveal] = useState<{ secret: string; created?: Channel } | null>(null);
  const [picking, setPicking] = useState<Channel | null>(null);

  const add = (type: ChannelType) => {
    setAdding(type === 'TELEGRAM_PLATFORM');
    setAddingWebhook(type === 'WEBHOOK');
  };
  const closeSecret = () => {
    if (reveal?.created) setPicking(reveal.created);
    setReveal(null);
  };

  const setFilter = (changes: Record<string, string>) =>
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        for (const [key, value] of Object.entries(filterParams(changes))) {
          if (value === null) next.delete(key);
          else next.set(key, value);
        }
        return next;
      },
      { replace: true },
    );

  const bulk = useMutation({
    mutationFn: async (action: 'on' | 'off' | 'delete') => {
      const needTest =
        action === 'on'
          ? all.filter(
              (channel) => selected.includes(channel.id) && channelStatus(channel) === 'failing',
            )
          : [];
      const skipped = new Set(needTest.map((channel) => channel.id));
      const results = await Promise.allSettled(
        selected
          .filter((id) => !skipped.has(id))
          .map((id) =>
            action === 'delete'
              ? deleteChannel(api, id)
              : patchChannel(api, id, { enabled: action === 'on' }),
          ),
      );
      const failed = results.find((result) => result.status === 'rejected');
      if (failed) throw failed.reason;
      return needTest;
    },
    onSuccess: async (needTest) => {
      setSelected([]);
      if (needTest.length > 0) {
        const names = needTest.map((channel) => channel.name).join(', ');
        toast.error(t('app.notifications.bulkNeedsTest', { names }));
      } else {
        toast.success(t('app.notifications.bulkDone'));
      }
      await refresh();
    },
    onError: async (error) => {
      toast.error(errorMessage(t, error));
      await refresh();
    },
  });

  const all = channels.data?.items ?? [];
  const shown = filterChannels(all, filters);
  const deviceList = devices.data?.items ?? [];
  const types = [...new Set(all.map((channel) => channel.type))];
  const showConnect = adding || (channels.data !== undefined && all.length === 0);
  const allShownSelected = shown.length > 0 && shown.every((c) => selected.includes(c.id));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-heading text-2xl font-semibold">{t('app.notifications.title')}</h1>
        <AddChannelMenu onAdd={add} />
      </div>
      {showConnect ? (
        <section
          data-motion="enter"
          className="rounded-lg border border-border bg-card p-4"
          aria-label={t('app.notifications.connect')}
        >
          <TelegramConnect />
        </section>
      ) : null}
      <section aria-labelledby="channels-title" className="flex flex-col gap-3">
        <h2
          id="channels-title"
          className="flex items-center gap-2 font-heading text-lg font-medium"
        >
          <BellRing aria-hidden="true" className="size-4" />
          {t('app.notifications.list')}
          {all.length > 0 ? (
            <span className="text-sm font-normal text-muted-foreground">
              {t('app.notifications.count', { shown: shown.length, total: all.length })}
            </span>
          ) : null}
        </h2>
        {channels.isPending ? (
          <output aria-label={t('app.common.loading')} className="flex flex-col gap-3">
            <Skeleton className="h-12" />
          </output>
        ) : channels.isError && !channels.data ? (
          <div role="alert" className="flex items-center gap-2 text-danger">
            <span>{errorMessage(t, channels.error)}</span>
            <Button variant="outline" size="sm" onClick={() => void channels.refetch()}>
              <RotateCw aria-hidden="true" />
              {t('app.common.retry')}
            </Button>
          </div>
        ) : all.length === 0 ? (
          <EmptyState illustration="channelsEmpty">
            <p>{t('app.notifications.empty')}</p>
          </EmptyState>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
              <div className="relative col-span-2 grow basis-48">
                <Search
                  aria-hidden="true"
                  className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  type="search"
                  aria-label={t('app.notifications.search')}
                  placeholder={t('app.notifications.search')}
                  value={filters.query}
                  onChange={(event) => setFilter({ q: event.target.value })}
                  className="ps-9 compact:ps-8"
                />
              </div>
              {types.length > 1 ? (
                <FilterSelect
                  label={t('app.notifications.filterType')}
                  value={filters.type}
                  onChange={(type) => setFilter({ type })}
                  options={[
                    { value: 'all', label: t('app.notifications.allTypes') },
                    ...types.map((type) => ({ value: type, label: t(`app.channel.type.${type}`) })),
                  ]}
                />
              ) : null}
              <FilterSelect
                label={t('app.notifications.filterDevice')}
                value={filters.device}
                onChange={(device) => setFilter({ device })}
                options={[
                  { value: 'all', label: t('app.notifications.allDevices') },
                  ...deviceList.map((device) => ({ value: device.id, label: device.name })),
                ]}
              />
              <FilterSelect
                label={t('app.notifications.filterStatus')}
                value={filters.status}
                onChange={(status) => setFilter({ status })}
                options={statuses.map((status) => ({
                  value: status,
                  label: t(`app.notifications.status.${status}`),
                }))}
              />
              <SortSelect
                label={t('app.notifications.sortBy')}
                value={filters.sort}
                onChange={(sort) => setFilter({ sort })}
                options={sorts.map((sort) => ({
                  value: sort,
                  label: t(`app.notifications.sort.${sort}`),
                }))}
              />
            </div>
            <div className="flex min-h-10 flex-wrap items-center gap-2 text-sm compact:min-h-8">
              <Checkbox
                checked={allShownSelected}
                onCheckedChange={(checked) =>
                  setSelected(checked ? shown.map((channel) => channel.id) : [])
                }
                aria-label={t('app.notifications.selectAll')}
              />
              {selected.length > 0 ? (
                <>
                  <span>{t('app.notifications.selected', { count: selected.length })}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={bulk.isPending}
                    onClick={() => bulk.mutate('on')}
                  >
                    {t('app.notifications.turnOn')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={bulk.isPending}
                    onClick={() => bulk.mutate('off')}
                  >
                    {t('app.notifications.turnOff')}
                  </Button>
                  <ConfirmDialog
                    trigger={
                      <Button variant="outline" size="sm" disabled={bulk.isPending}>
                        {t('app.notifications.delete')}
                      </Button>
                    }
                    title={t('app.notifications.bulkDeleteTitle', { count: selected.length })}
                    body={t('app.notifications.removeBody')}
                    confirmLabel={t('app.notifications.delete')}
                    destructive
                    onConfirm={() => bulk.mutate('delete')}
                  />
                </>
              ) : (
                <span className="text-muted-foreground">{t('app.notifications.selectAll')}</span>
              )}
            </div>
            {shown.length === 0 ? (
              <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
                <span>{t('app.notifications.noMatch')}</span>
                <Button variant="ghost" size="sm" onClick={() => setParams({}, { replace: true })}>
                  {t('app.notifications.clearFilters')}
                </Button>
              </div>
            ) : (
              <ul className="flex flex-col gap-2">
                {shown.map((channel, index) => (
                  <ChannelRow
                    key={channel.id}
                    channel={channel}
                    devices={deviceList}
                    index={index}
                    onSecret={(secret) => setReveal({ secret })}
                    selected={selected.includes(channel.id)}
                    onSelect={(value) =>
                      setSelected(
                        value
                          ? [...selected, channel.id]
                          : selected.filter((id) => id !== channel.id),
                      )
                    }
                  />
                ))}
              </ul>
            )}
          </>
        )}
      </section>
      <GuideLink />
      <WebhookForm
        open={addingWebhook}
        onOpenChange={setAddingWebhook}
        onCreated={(created, secret) => setReveal({ secret, created })}
      />
      <WebhookSecretDialog secret={reveal?.secret ?? null} onClose={closeSecret} />
      <Dialog open={picking !== null} onOpenChange={(open) => !open && setPicking(null)}>
        {picking ? (
          <DevicesDialogContent
            channel={picking}
            devices={deviceList}
            onSaved={() => setPicking(null)}
          />
        ) : null}
      </Dialog>
    </div>
  );
}
