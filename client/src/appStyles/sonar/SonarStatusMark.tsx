import { useTranslation } from 'react-i18next';
import { useStateChange } from '@/lib/useStateChange';
import { cn } from '@/lib/utils';
import type { StatusMarkProps } from '../slots';

type SonarStatusMarkProps = StatusMarkProps & { size?: 'md' | 'lg'; showLabel?: boolean };

export function SonarStatusMark({
  state,
  lastSeenAt = null,
  size = 'md',
  showLabel = false,
}: SonarStatusMarkProps) {
  const { t } = useTranslation();
  const checkedIn = useStateChange(lastSeenAt, 1200);
  const stateChanged = useStateChange(state, 1200);
  return (
    <span className="inline-flex items-center gap-2">
      <span
        aria-hidden="true"
        data-state={state}
        data-size={size}
        data-motion="ambient"
        data-pulse={checkedIn || stateChanged ? '' : undefined}
        className="sonar-dot"
      />
      <span className={cn(showLabel ? 'text-sm font-medium' : 'sr-only')}>
        {t(`app.state.${state}`)}
      </span>
    </span>
  );
}
