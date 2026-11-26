import type { Channel, DeviceListItem } from '@elec/shared/api';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { putChannelDevices } from '@/api/endpoints';
import { useSession } from '@/api/session';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { errorMessage } from '@/forms/errorMessage';
import { FormAlert } from '@/forms/FormAlert';
import { useChannelRefresh } from './useChannelRefresh';

type Props = { channel: Channel; devices: DeviceListItem[] };
type ContentProps = Props & { onSaved: () => void };

export function DevicesDialogContent({ channel, devices, onSaved }: ContentProps) {
  const { t } = useTranslation();
  const { api } = useSession();
  const refresh = useChannelRefresh();
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState<string[]>(channel.device_ids);
  const save = useMutation({
    mutationFn: (ids: string[]) => putChannelDevices(api, channel.id, { device_ids: ids }),
    onSuccess: async () => {
      onSaved();
      toast.success(t('app.notifications.devicesSaved'));
      await refresh();
    },
  });
  const shown = devices.filter((device) =>
    device.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );

  return (
    <DialogContent className="max-h-[calc(100dvh-2rem)] gap-4 overflow-y-auto sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{t('app.notifications.editDevicesTitle', { name: channel.name })}</DialogTitle>
      </DialogHeader>
      <Input
        type="search"
        aria-label={t('app.notifications.searchDevices')}
        placeholder={t('app.notifications.searchDevices')}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <FormAlert message={save.error ? errorMessage(t, save.error) : null} />
      <ul className="flex max-h-72 flex-col gap-2 overflow-y-auto">
        {shown.map((device) => (
          <li key={device.id} className="flex items-center gap-2">
            <Checkbox
              id={`edit-${channel.id}-${device.id}`}
              checked={chosen.includes(device.id)}
              onCheckedChange={(checked) =>
                setChosen(
                  checked ? [...chosen, device.id] : chosen.filter((id) => id !== device.id),
                )
              }
            />
            <Label htmlFor={`edit-${channel.id}-${device.id}`}>{device.name}</Label>
          </li>
        ))}
      </ul>
      <Button
        disabled={save.isPending}
        onClick={() => save.mutate(devices.map((d) => d.id).filter((id) => chosen.includes(id)))}
      >
        {t('app.channel.save')}
      </Button>
    </DialogContent>
  );
}

export function EditDevicesDialog({ channel, devices }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm">
            {t('app.notifications.editDevices')}
          </Button>
        }
      />
      <DevicesDialogContent channel={channel} devices={devices} onSaved={() => setOpen(false)} />
    </Dialog>
  );
}
