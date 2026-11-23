import { useTranslation } from 'react-i18next';
import { Link, NavLink, Outlet } from 'react-router';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { apiUrl } from '@/lib/config';
import { cn } from '@/lib/utils';
import { VerifyBanner } from './VerifyBanner';

function navClass({ isActive }: { isActive: boolean }) {
  return cn(
    'rounded-md px-2 py-1 text-sm hover:bg-secondary',
    isActive ? 'bg-secondary font-medium text-secondary-foreground' : 'text-foreground',
  );
}

export function Layout() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-svh flex-col">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-2 px-4 py-2">
          <Link to="/devices" className="font-heading font-semibold">
            Elec
          </Link>
          <nav aria-label={t('app.nav.main')} className="flex flex-1 flex-wrap items-center gap-1">
            <NavLink to="/devices" className={navClass}>
              {t('app.nav.devices')}
            </NavLink>
            <NavLink to="/notifications" className={navClass}>
              {t('app.nav.notifications')}
            </NavLink>
            <NavLink to="/account" className={navClass}>
              {t('app.nav.account')}
            </NavLink>
          </nav>
          <a
            href={`${apiUrl()}/api/docs`}
            className="text-sm text-primary underline-offset-4 hover:underline"
          >
            {t('app.nav.apiDocs')}
          </a>
          <LanguageSwitcher />
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 p-4">
        <VerifyBanner />
        <Outlet />
      </main>
    </div>
  );
}
