import { BellRing } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type CSSProperties, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { putDeviceChannels } from '@/api/endpoints';
import { queryKeys, useChannels, useDeviceChannels } from '@/api/queries';
import { useSession } from '@/api/session';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/forms/errorMessage';
import { FormAlert } from '@/forms/FormAlert';

export function DeviceChannels({ deviceId }: { deviceId: string }) {
  const { t } = useTranslation();
  const { api } = useSession();
  const queryClient = useQueryClient();
  const channels = useChannels();
  const linked = useDeviceChannels(deviceId);
  const [edited, setEdited] = useState<string[] | null>(null);

  const save = useMutation({
    mutationFn: (ids: string[]) => putDeviceChannels(api, deviceId, { channel_ids: ids }),
    onSuccess: async (response) => {
      queryClient.setQueryData(queryKeys.deviceChannels(deviceId), response);
      setEdited(null);
      toast.success(t('app.channel.saved'));
      await queryClient.invalidateQueries({ queryKey: queryKeys.deviceChannels(deviceId) });
    },
  });

  const heading = (
    <h2 id="channels-title" className="flex items-center gap-2 font-heading text-lg font-medium">
      <BellRing aria-hidden="true" className="size-4" />
      {t('app.channel.title')}
    </h2>
  );

  if (channels.isPending || linked.isPending) {
    return (
      <section aria-labelledby="channels-title" className="flex flex-col gap-3">
        {heading}
        <output aria-label={t('app.common.loading')}>
          <Skeleton className="h-10" />
        </output>
      </section>
    );
  }
  const failure = channels.error ?? linked.error;
  if (failure || !channels.data || !linked.data) {
    return (
      <section aria-labelledby="channels-title" className="flex flex-col gap-3">
        {heading}
        <p role="alert" className="text-danger">
          {errorMessage(t, failure)}
        </p>
      </section>
    );
  }

  const items = channels.data.items;
  if (items.length === 0) {
    return (
      <section aria-labelledby="channels-title" className="flex flex-col gap-3">
        {heading}
        <p className="text-sm text-muted-foreground">{t('app.channel.none')}</p>
        <Link to="/notifications" className="underline">
          {t('app.channel.connectLink')}
        </Link>
      </section>
    );
  }

  const selected = edited ?? linked.data.channel_ids;
  const toggle = (id: string, checked: boolean) =>
    setEdited(checked ? [...selected, id] : selected.filter((current) => current !== id));

  return (
    <section aria-labelledby="channels-title" className="flex flex-col gap-3">
      {heading}
      <FormAlert message={save.error ? errorMessage(t, save.error) : null} />
      <ul className="flex flex-col gap-2">
        {items.map((channel, index) => (
          <li
            key={channel.id}
            data-motion="enter"
            style={{ '--i': index } as CSSProperties}
            className="flex items-center gap-2"
          >
            <Checkbox
              id={`channel-${channel.id}`}
              checked={selected.includes(channel.id)}
              onCheckedChange={(checked) => toggle(channel.id, checked)}
            />
            <Label htmlFor={`channel-${channel.id}`}>{channel.name}</Label>
          </li>
        ))}
      </ul>
      <div>
        <Button
          disabled={save.isPending}
          onClick={() =>
            save.mutate(items.map((channel) => channel.id).filter((id) => selected.includes(id)))
          }
        >
          {t('app.channel.save')}
        </Button>
      </div>
    </section>
  );
}
