import type { DeviceState } from '@elec/shared';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';

const presentation: Record<DeviceState, { icon: string; color: string }> = {
  ONLINE: { icon: '🟢', color: 'text-status-online' },
  OFFLINE: { icon: '🔴', color: 'text-status-offline' },
  PENDING: { icon: '⚪', color: 'text-status-pending' },
  UPDATING: { icon: '⚪', color: 'text-status-pending' },
};

export function StatusBadge({ state }: { state: DeviceState }) {
  const { t } = useTranslation();
  const { icon, color } = presentation[state];
  return (
    <Badge variant="outline" className={color}>
      <span aria-hidden="true">{icon}</span>
      {t(`app.state.${state}`)}
    </Badge>
  );
}
