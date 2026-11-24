import type { DeviceState } from '@elec/shared';
import { Circle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { useStateChange } from '@/lib/useStateChange';
import type { StatusMarkProps } from '../slots';

const color: Record<DeviceState, string> = {
  ONLINE: 'text-status-online',
  OFFLINE: 'text-status-offline',
  PENDING: 'text-status-pending',
  UPDATING: 'text-status-pending',
};

export function ClassicStatusMark({ state }: StatusMarkProps) {
  const { t } = useTranslation();
  const changed = useStateChange(state, 400);
  return (
    <Badge
      variant="outline"
      data-motion={changed ? 'change' : undefined}
      className={`${color[state]} classic-badge`}
    >
      <Circle aria-hidden="true" className="size-2.5 fill-current" />
      {t(`app.state.${state}`)}
    </Badge>
  );
}
