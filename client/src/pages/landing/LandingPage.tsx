import { ArrowRight, BellRing, Cable, Wifi } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { BrandMark, Wordmark } from '@/components/BrandMark';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { PromoHero } from '@/components/PromoHero';
import { buttonVariants } from '@/components/ui/button';
import { apiUrl } from '@/lib/config';
import { cn } from '@/lib/utils';
import { HistoryDemo, PowerDemo, TelegramDemo } from './LandingDemos';

const year = new Date().getFullYear();
const wrap = 'mx-auto w-full max-w-6xl px-4 sm:px-6';

function SignupLink({ size = 'lg' }: { size?: 'default' | 'lg' }) {
  const { t } = useTranslation();
  return (
    <Link to="/signup" className={buttonVariants({ size })}>
      {t('app.landing.signup')}
      <ArrowRight aria-hidden="true" data-icon="inline-end" />
    </Link>
  );
}

function Section({
  id,
  title,
  lead,
  visual,
  children,
  flip = false,
}: {
  id: string;
  title: string;
  lead: string;
  visual: ReactNode;
  children?: ReactNode;
  flip?: boolean;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="flex min-h-[80svh] items-center border-t border-border py-16 sm:py-24"
    >
      <div className={cn(wrap, 'grid items-center gap-10 lg:grid-cols-2 lg:gap-16')}>
        <div className={cn('flex flex-col gap-4', flip && 'lg:order-2')}>
          <h2 id={`${id}-title`} className="font-heading text-3xl font-bold sm:text-4xl">
            {title}
          </h2>
          <p className="max-w-prose text-lg text-muted-foreground">{lead}</p>
          {children}
        </div>
        <div className={cn('flex justify-center', flip && 'lg:order-1')}>{visual}</div>
      </div>
    </section>
  );
}

const steps = [
  { key: 'device', icon: Cable },
  { key: 'wifi', icon: Wifi },
  { key: 'alerts', icon: BellRing },
] as const;

export function LandingPage() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-svh flex-col">
      <header className="border-b border-border bg-surface">
        <div className={cn(wrap, 'flex items-center gap-3 py-2')}>
          <Link
            to="/"
            className="flex min-w-0 items-center gap-2 rounded-md focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <BrandMark className="size-7" />
            <Wordmark className="truncate text-sm sm:text-base" />
          </Link>
          <nav aria-label={t('app.landing.navLabel')} className="ml-auto flex items-center gap-2">
            <Link to="/login" className={buttonVariants({ variant: 'ghost' })}>
              {t('app.landing.login')}
            </Link>
            <span className="hidden sm:block">
              <SignupLink size="default" />
            </span>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <section
          aria-labelledby="hero-title"
          className="flex min-h-[calc(100svh-3.75rem)] items-center py-12 sm:py-16"
        >
          <div className={cn(wrap, 'grid items-center gap-10 lg:grid-cols-[5fr_6fr] lg:gap-12')}>
            <div className="flex flex-col items-start gap-6">
              <h1
                id="hero-title"
                data-motion="enter"
                className="font-heading text-4xl leading-[1.1] font-extrabold sm:text-5xl"
              >
                {t('app.landing.hero.title')}
              </h1>
              <p
                data-motion="enter"
                style={{ '--i': 1 } as CSSProperties}
                className="max-w-xl text-lg text-muted-foreground"
              >
                {t('app.landing.hero.lead')}
              </p>
              <div
                data-motion="enter"
                style={{ '--i': 2 } as CSSProperties}
                className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row"
              >
                <SignupLink />
                <a href="#how" className={buttonVariants({ variant: 'outline', size: 'lg' })}>
                  {t('app.landing.hero.how')}
                </a>
              </div>
              <p
                data-motion="enter"
                style={{ '--i': 3 } as CSSProperties}
                className="font-mono text-sm text-muted-foreground"
              >
                {t('app.landing.hero.fact')}
              </p>
            </div>
            <div data-motion="enter" style={{ '--i': 2 } as CSSProperties}>
              <PromoHero className="mx-auto max-w-none" />
            </div>
          </div>
        </section>

        <Section
          id="how"
          title={t('app.landing.how.title')}
          lead={t('app.landing.how.lead')}
          visual={<PowerDemo />}
        >
          <ol className="mt-2 flex flex-col gap-5">
            {steps.map(({ key, icon: Icon }, index) => (
              <li key={key} className="flex gap-4">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-secondary text-foreground">
                  <Icon aria-hidden="true" className="size-5" />
                </span>
                <div className="flex flex-col gap-1">
                  <h3 className="font-semibold">
                    <span className="mr-2 font-mono text-muted-foreground">0{index + 1}</span>
                    {t(`app.landing.how.steps.${key}.title`)}
                  </h3>
                  <p className="text-muted-foreground">{t(`app.landing.how.steps.${key}.body`)}</p>
                </div>
              </li>
            ))}
          </ol>
        </Section>

        <Section
          id="history"
          flip
          title={t('app.landing.history.title')}
          lead={t('app.landing.history.lead')}
          visual={<HistoryDemo />}
        />

        <Section
          id="alerts"
          title={t('app.landing.alerts.title')}
          lead={t('app.landing.alerts.lead')}
          visual={<TelegramDemo />}
        />

        <section
          aria-labelledby="start-title"
          className="flex min-h-[60svh] items-center border-t border-border py-16 sm:py-24"
        >
          <div className={cn(wrap, 'flex flex-col items-start gap-6')}>
            <h2
              id="start-title"
              className="max-w-4xl font-heading text-4xl leading-[1.1] font-extrabold sm:text-6xl"
            >
              {t('app.landing.start.title')}
            </h2>
            <p className="max-w-xl text-lg text-muted-foreground">{t('app.landing.start.lead')}</p>
            <SignupLink />
          </div>
        </section>
      </main>

      <footer className="border-t border-border bg-surface">
        <div
          className={cn(
            wrap,
            'flex flex-col gap-4 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center',
          )}
        >
          <span className="flex items-center gap-2">
            <BrandMark className="size-6" />
            <span>© {year}</span>
          </span>
          <nav aria-label={t('app.landing.footerLabel')} className="flex flex-wrap gap-x-4 gap-y-1">
            <Link
              to="/login"
              className="inline-flex min-h-11 items-center underline-offset-4 hover:text-foreground hover:underline compact:min-h-0"
            >
              {t('app.landing.login')}
            </Link>
            <a
              href={`${apiUrl()}/api/docs`}
              className="inline-flex min-h-11 items-center underline-offset-4 hover:text-foreground hover:underline compact:min-h-0"
            >
              {t('app.landing.api')}
            </a>
          </nav>
          <div className="sm:ml-auto">
            <LanguageSwitcher />
          </div>
        </div>
      </footer>
    </div>
  );
}
