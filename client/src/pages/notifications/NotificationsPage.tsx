import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { deleteChannel } from '@/api/endpoints';
import { queryKeys, useChannels } from '@/api/queries';
import { useSession } from '@/api/session';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/forms/errorMessage';
import { FormAlert } from '@/forms/FormAlert';
import { TelegramConnect } from './TelegramConnect';

export function NotificationsPage() {
  const { t } = useTranslation();
  const { api } = useSession();
  const queryClient = useQueryClient();
  const channels = useChannels();

  const remove = useMutation({
    mutationFn: (id: string) => deleteChannel(api, id),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.channels }),
        queryClient.invalidateQueries({ queryKey: ['deviceChannels'] }),
      ]);
    },
  });

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-heading text-2xl font-semibold">{t('app.notifications.title')}</h1>
      <section aria-labelledby="channels-title" className="flex flex-col gap-3">
        <h2 id="channels-title" className="font-heading text-lg font-medium">
          {t('app.notifications.list')}
        </h2>
        <FormAlert message={remove.error ? errorMessage(t, remove.error) : null} />
        {channels.isPending ? (
          <output aria-label={t('app.common.loading')} className="flex flex-col gap-3">
            <Skeleton className="h-12" />
          </output>
        ) : channels.isError && !channels.data ? (
          <div role="alert" className="flex items-center gap-2 text-danger">
            <span>{errorMessage(t, channels.error)}</span>
            <Button variant="outline" size="sm" onClick={() => void channels.refetch()}>
              {t('app.common.retry')}
            </Button>
          </div>
        ) : channels.data.items.length === 0 ? (
          <p className="text-muted-foreground">{t('app.notifications.empty')}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {channels.data.items.map((channel) => (
              <li
                key={channel.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{channel.name}</span>
                  <Badge variant="secondary">{t(`app.channel.type.${channel.type}`)}</Badge>
                  <Badge variant="outline">
                    {channel.enabled
                      ? t('app.notifications.enabled')
                      : t('app.notifications.disabled')}
                  </Badge>
                  {channel.disabled_reason ? (
                    <Badge variant="outline" className="text-danger">
                      {t(`app.channel.reason.${channel.disabled_reason}`)}
                    </Badge>
                  ) : null}
                </div>
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
                  onConfirm={() => remove.mutate(channel.id)}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
      <TelegramConnect />
    </div>
  );
}
