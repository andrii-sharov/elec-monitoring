import { Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { themeChoices, useTheme, type ThemeChoice } from '@/lib/theme';
import { useRadioGroup } from '@/lib/useRadioGroup';
import { cn } from '@/lib/utils';

const icons: Record<ThemeChoice, LucideIcon> = { system: Monitor, light: Sun, dark: Moon };

export function ThemeControl() {
  const { t } = useTranslation();
  const [theme, setTheme] = useTheme();
  const { itemProps } = useRadioGroup(themeChoices, theme, setTheme);
  return (
    <div
      role="radiogroup"
      aria-label={t('app.theme.label')}
      className="inline-flex self-start rounded-lg bg-secondary p-1 max-sm:flex max-sm:self-stretch"
    >
      {themeChoices.map((choice) => {
        const Icon = icons[choice];
        return (
          <button
            key={choice}
            type="button"
            {...itemProps(choice)}
            className={cn(
              'flex min-h-10 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm max-sm:flex-1 compact:min-h-0 transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
              choice === theme
                ? 'bg-surface font-medium text-foreground shadow-sm'
                : 'text-secondary-foreground hover:bg-surface/50',
            )}
          >
            <Icon aria-hidden="true" className="size-4" />
            {t(`app.theme.${choice}`)}
          </button>
        );
      })}
    </div>
  );
}
