import { Lightbulb, LightbulbOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { StatusMarkProps } from '../slots';

export function LampStatusMark({ state }: StatusMarkProps) {
  const { t } = useTranslation();
  const on = state === 'ONLINE';
  const Icon = on ? Lightbulb : LightbulbOff;
  return (
    <span
      data-state={state}
      className="lamp-mark inline-flex items-center gap-1.5 text-sm font-medium"
    >
      <span className="relative inline-flex">
        {on ? <span aria-hidden="true" data-motion="flicker" className="lamp-glow" /> : null}
        <Icon aria-hidden="true" className="relative size-5" />
      </span>
      {t(`app.state.${state}`)}
    </span>
  );
}
