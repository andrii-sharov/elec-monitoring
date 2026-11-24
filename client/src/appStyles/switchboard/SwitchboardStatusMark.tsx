import type { DeviceState } from '@elec/shared';
import { useTranslation } from 'react-i18next';
import { useStateChange } from '@/lib/useStateChange';
import { cn } from '@/lib/utils';
import type { StatusMarkProps } from '../slots';

const position: Record<DeviceState, 'up' | 'down' | 'middle'> = {
  ONLINE: 'up',
  OFFLINE: 'down',
  PENDING: 'middle',
  UPDATING: 'middle',
};

type SwitchboardStatusMarkProps = StatusMarkProps & { size?: 'md' | 'lg'; showLabel?: boolean };

export function SwitchboardStatusMark({
  state,
  size = 'md',
  showLabel = false,
}: SwitchboardStatusMarkProps) {
  const { t } = useTranslation();
  const changed = useStateChange(state, 600);
  return (
    <span className="inline-flex items-center gap-2">
      <span
        aria-hidden="true"
        data-position={position[state]}
        data-state={state}
        data-size={size}
        data-motion="lever"
        data-snap={changed ? '' : undefined}
        className="switchboard-lever"
      >
        <span className="switchboard-handle" />
      </span>
      <span className={cn(showLabel ? 'text-sm font-medium' : 'sr-only')}>
        {t(`app.state.${state}`)}
      </span>
    </span>
  );
}
