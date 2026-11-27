import type { DeviceState } from '@elec/shared';
import { useTranslation } from 'react-i18next';
import { useStateChange } from '@/lib/useStateChange';
import { cn } from '@/lib/utils';

export type StatusMarkProps = {
  state: DeviceState;
  lastSeenAt?: string | null;
  className?: string;
};

const tone: Record<DeviceState, string> = {
  ONLINE: 'text-status-online',
  OFFLINE: 'text-status-offline',
  PENDING: 'text-status-pending',
  UPDATING: 'text-status-pending',
};

export function StatusDot({ state, lastSeenAt }: Pick<StatusMarkProps, 'state' | 'lastSeenAt'>) {
  const checkedIn = useStateChange(lastSeenAt ?? null, 900);
  const pulse = state === 'ONLINE' && checkedIn;
  return (
    <span
      aria-hidden="true"
      data-state={state}
      data-pulse={pulse ? '' : undefined}
      className="status-dot"
    />
  );
}

export function StatusMark({ state, lastSeenAt, className }: StatusMarkProps) {
  const { t } = useTranslation();
  const changed = useStateChange(state, 400);
  return (
    <span
      data-motion={changed ? 'change' : undefined}
      className={cn(
        'status-mark inline-flex h-6 w-fit shrink-0 items-center gap-1.5 rounded-full border border-current/30 px-2.5 font-mono text-xs font-medium tracking-wider uppercase',
        tone[state],
        className,
      )}
    >
      <StatusDot state={state} lastSeenAt={lastSeenAt} />
      {t(`app.state.${state}`)}
    </span>
  );
}
