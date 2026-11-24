import { Zap } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';
import { useSession } from '@/api/session';
import { AppStyleProvider } from '@/appStyles/AppStyleProvider';
import { appStylePreference, type AppStyleId } from '@/appStyles/registry';
import { AppStylePicker } from '@/components/AppStylePicker';
import { ThemeControl } from '@/components/ThemeControl';
import { Button } from '@/components/ui/button';
import { safeNext } from '@/lib/safeNext';

function destination(raw: string | null): string {
  const next = safeNext(raw);
  return next.startsWith('/welcome') ? '/devices' : next;
}

export function WelcomeAppearancePage() {
  const { t } = useTranslation();
  const { me } = useSession();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [selected, setSelected] = useState<AppStyleId>(() => appStylePreference.read());

  function choose(id: AppStyleId) {
    appStylePreference.write(id);
    void navigate(destination(params.get('next')), { replace: true });
  }

  return (
    <AppStyleProvider id={selected}>
      <div
        data-app-style={selected}
        className="min-h-svh text-foreground"
        style={{ background: 'var(--app-backdrop)' }}
      >
        <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-10">
          <span className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Zap aria-hidden="true" className="size-5" />
          </span>
          <div className="flex flex-col gap-2">
            <h1 className="font-heading text-3xl font-semibold tracking-tight">
              {t('common.greeting', { name: me?.name ?? '' })}
            </h1>
            <p className="text-muted-foreground">{t('app.welcome.lead')}</p>
          </div>
          <ThemeControl />
          <AppStylePicker
            value={selected}
            onChange={setSelected}
            label={t('app.appearance.style')}
          />
          <div className="flex flex-wrap gap-2">
            <Button size="lg" onClick={() => choose(selected)}>
              {t('app.welcome.useStyle')}
            </Button>
            <Button size="lg" variant="outline" onClick={() => choose('classic')}>
              {t('app.welcome.keepClassic')}
            </Button>
          </div>
        </main>
      </div>
    </AppStyleProvider>
  );
}
