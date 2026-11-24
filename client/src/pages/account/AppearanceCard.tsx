import { useTranslation } from 'react-i18next';
import { useAppStylePreference } from '@/appStyles/AppStyleProvider';
import { AppStylePicker } from '@/components/AppStylePicker';
import { ThemeControl } from '@/components/ThemeControl';

export function AppearanceCard() {
  const { t } = useTranslation();
  const [appStyle, setAppStyle] = useAppStylePreference();
  return (
    <section aria-labelledby="appearance-title" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="appearance-title" className="font-heading text-lg font-medium">
          {t('app.appearance.title')}
        </h2>
        <p className="text-sm text-muted-foreground">{t('app.appearance.hint')}</p>
      </div>
      <ThemeControl />
      <AppStylePicker value={appStyle} onChange={setAppStyle} label={t('app.appearance.style')} />
    </section>
  );
}
