import type { DeliveryStatus } from '@elec/shared';
import type { Channel, DeliveryItem, DeviceListItem } from '@elec/shared/api';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CircleAlert, CircleCheck, Clock, RotateCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { redeliver } from '@/api/endpoints';
import { isApiError } from '@/api/errors';
import { queryKeys, useDeliveries } from '@/api/queries';
import { useSession } from '@/api/session';
import { Tag } from '@/components/OutageTags';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/forms/errorMessage';
import { FormAlert } from '@/forms/FormAlert';
import { useFormatters } from '@/lib/format';

const statusTag = {
  QUEUED: { icon: Clock, look: 'dashed' },
  SENT: { icon: CircleCheck, look: 'fill-live' },
  RETRYING: { icon: RotateCw, look: 'outline-warning' },
  FAILED: { icon: CircleAlert, look: 'fill-offline' },
} as const;

const redeliverable: DeliveryStatus[] = ['SENT', 'FAILED'];

type RowProps = {
  channel: Channel;
  delivery: DeliveryItem;
  deviceName: string;
};

function DeliveryRow({ channel, delivery, deviceName }: RowProps) {
  const { t } = useTranslation();
  const { api } = useSession();
  const queryClient = useQueryClient();
  const format = useFormatters();
  const at = delivery.last_attempt_at ?? delivery.created_at;
  const again = useMutation({
    mutationFn: () => redeliver(api, delivery.id),
    onSuccess: () => toast.success(t('app.notifications.webhook.redelivered')),
    onError: async (error) => {
      if (!isApiError(error, 'conflict')) {
        toast.error(errorMessage(t, error));
        return;
      }
      await queryClient.invalidateQueries({ queryKey: queryKeys.channels });
      const fresh = queryClient
        .getQueryData<{ items: Channel[] }>(queryKeys.channels)
        ?.items.find((item) => item.id === channel.id);
      toast.error(
        fresh?.enabled === false
          ? t('app.notifications.webhook.turnOnFirst')
          : t('app.notifications.webhook.inProgress'),
      );
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.deliveries(channel.id) }),
  });

  return (
    <li className="flex flex-col gap-1 border-t border-border pt-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-3 sm:gap-y-1">
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
          <code className="font-mono text-xs break-all">{delivery.event}</code>
          <span className="font-medium sm:font-normal">{deviceName}</span>
        </span>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Tag {...statusTag[delivery.status]}>
            {t(`app.notifications.webhook.status.${delivery.status}`)}
          </Tag>
          <span className="text-xs text-muted-foreground">
            {t('app.notifications.webhook.attempts', { attempts: delivery.attempts })}
          </span>
          <time dateTime={at} className="text-xs text-muted-foreground">
            {format.moment(at)}
          </time>
        </span>
        {redeliverable.includes(delivery.status) ? (
          <Button
            variant="outline"
            size="xs"
            className="max-sm:w-full sm:ms-auto"
            disabled={!channel.enabled || again.isPending}
            onClick={() => again.mutate()}
          >
            {t('app.notifications.webhook.redeliver')}
          </Button>
        ) : null}
      </div>
      {delivery.last_error ? (
        <p className="text-xs break-all text-status-offline">{delivery.last_error}</p>
      ) : null}
    </li>
  );
}

type Props = { channel: Channel; devices: DeviceListItem[] };

export function DeliveryLog({ channel, devices }: Props) {
  const { t } = useTranslation();
  const log = useDeliveries(channel.id);
  const pages = log.data?.pages ?? [];
  const empty = pages.every((page) => page.items.length === 0);

  return (
    <section
      aria-label={t('app.notifications.webhook.log')}
      className="flex flex-col gap-2 text-sm"
    >
      {log.isPending ? (
        <output aria-label={t('app.common.loading')}>
          <Skeleton className="h-10" />
        </output>
      ) : log.isError && !log.data ? (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-danger">
          <span>{errorMessage(t, log.error)}</span>
          <Button variant="outline" size="sm" onClick={() => void log.refetch()}>
            {t('app.common.retry')}
          </Button>
        </div>
      ) : empty ? (
        <p className="text-muted-foreground">{t('app.notifications.webhook.empty')}</p>
      ) : (
        <>
          {channel.enabled ? null : (
            <p className="text-muted-foreground">{t('app.notifications.webhook.disabledHint')}</p>
          )}
          <ul className="flex flex-col gap-2">
            {pages.flatMap((page) =>
              page.items.map((delivery) => (
                <DeliveryRow
                  key={delivery.id}
                  channel={channel}
                  delivery={delivery}
                  deviceName={
                    devices.find((device) => device.id === delivery.device_id)?.name ??
                    t('app.notifications.webhook.unknownDevice')
                  }
                />
              )),
            )}
          </ul>
        </>
      )}
      <FormAlert message={log.isFetchNextPageError ? errorMessage(t, log.error) : null} />
      {log.hasNextPage ? (
        <Button
          variant="outline"
          size="sm"
          className="max-sm:w-full sm:self-start"
          disabled={log.isFetchingNextPage}
          onClick={() => void log.fetchNextPage()}
        >
          {t('app.notifications.webhook.loadMore')}
        </Button>
      ) : null}
    </section>
  );
}
