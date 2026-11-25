import type { DeviceState } from '@elec/shared';
import { useTranslation } from 'react-i18next';
import { useFormatters } from '@/lib/format';
import { useNow } from '@/lib/useNow';

type StateDurationProps = {
  state: DeviceState;
  since: string;
  className?: string;
};

export const liveTickMs = 1000;

export function useLiveDuration(since: string): string {
  const format = useFormatters();
  const now = useNow(liveTickMs);
  return format.duration((now - new Date(since).getTime()) / 1000);
}

function useStateDurationText(state: DeviceState, since: string): string {
  const { t } = useTranslation();
  const duration = useLiveDuration(since);
  switch (state) {
    case 'ONLINE':
      return t('app.device.duration.online', { duration });
    case 'OFFLINE':
      return t('app.device.duration.offline', { duration });
    case 'PENDING':
      return t('app.device.duration.pending');
    case 'UPDATING':
      return t('app.device.duration.updating');
  }
}

export function StateDuration({ state, since, className }: StateDurationProps) {
  return <span className={className}>{useStateDurationText(state, since)}</span>;
}
