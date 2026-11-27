import type { Device } from '@elec/shared/api';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Router, WifiOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { pauseNetworkAlerts, resumeNetworkAlerts } from '@/api/endpoints';
import { queryKeys } from '@/api/queries';
import { useSession } from '@/api/session';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { errorMessage } from '@/forms/errorMessage';
import { useFormatters } from '@/lib/format';

const durations = [10, 15, 30, 60];

export function activePause(device: Device, now = Date.now()): string | null {
  const until = device.network_pause_until;
  return until && Date.parse(until) > now ? until : null;
}

export function NetworkPause({ device }: { device: Device }) {
  const { t } = useTranslation();
  const { api } = useSession();
  const queryClient = useQueryClient();
  const format = useFormatters();
  const owner = device.role === 'OWNER';
  const until = activePause(device);
  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.device(device.id) });
  const fail = (error: unknown) => toast.error(errorMessage(t, error));
  const pause = useMutation({
    mutationFn: (minutes: number) => pauseNetworkAlerts(api, device.id, minutes),
    onSuccess: refresh,
    onError: fail,
  });
  const resume = useMutation({
    mutationFn: () => resumeNetworkAlerts(api, device.id),
    onSuccess: refresh,
    onError: fail,
  });

  if (until) {
    return (
      <div
        data-motion="enter"
        className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-dashed border-border px-3 py-2 text-sm"
      >
        <WifiOff aria-hidden="true" className="size-4 text-muted-foreground" />
        <span>{t('app.device.pause.until', { time: format.time(until) })}</span>
        {owner ? (
          <Button
            variant="outline"
            size="sm"
            className="ms-auto"
            disabled={resume.isPending}
            onClick={() => resume.mutate()}
          >
            {t('app.device.pause.resume')}
          </Button>
        ) : null}
      </div>
    );
  }
  if (!owner || device.state === 'PENDING') return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="outline" size="sm" className="self-start" disabled={pause.isPending}>
            <Router aria-hidden="true" />
            {t('app.device.pause.start')}
          </Button>
        }
      />
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t('app.device.pause.hint')}</DropdownMenuLabel>
          {durations.map((minutes) => (
            <DropdownMenuItem key={minutes} onClick={() => pause.mutate(minutes)}>
              {format.duration(minutes * 60)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
