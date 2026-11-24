import { Bell, Cpu, Zap, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link, NavLink, Outlet } from 'react-router';
import { cn } from '@/lib/utils';
import { AccountMenu } from './AccountMenu';
import { VerifyBanner } from './VerifyBanner';

function navClass({ isActive }: { isActive: boolean }) {
  return cn(
    'flex items-center gap-1.5 rounded-md px-2 py-1 text-sm hover:bg-secondary focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
    isActive ? 'bg-secondary font-medium text-secondary-foreground' : 'text-foreground',
  );
}

function NavItem({ to, icon: Icon, label }: { to: string; icon: LucideIcon; label: string }) {
  return (
    <NavLink to={to} viewTransition className={navClass}>
      <Icon aria-hidden="true" className="size-3.5 sm:size-4" />
      {label}
    </NavLink>
  );
}

export function Layout() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-svh flex-col">
      <header className="app-header border-b border-border bg-surface">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-2 px-4 py-2">
          <Link
            to="/devices"
            viewTransition
            className="flex items-center gap-1.5 rounded-md font-heading font-semibold focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Zap aria-hidden="true" className="size-4" />
            </span>
            Elec
          </Link>
          <nav aria-label={t('app.nav.main')} className="flex flex-1 flex-wrap items-center gap-1">
            <NavItem to="/devices" icon={Cpu} label={t('app.nav.devices')} />
            <NavItem to="/notifications" icon={Bell} label={t('app.nav.notifications')} />
          </nav>
          <AccountMenu />
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 p-4">
        <VerifyBanner />
        <Outlet />
      </main>
    </div>
  );
}
