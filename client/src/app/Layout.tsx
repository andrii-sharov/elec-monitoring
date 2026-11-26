import { Bell, Cpu, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link, NavLink, Outlet } from 'react-router';
import { BrandMark } from '@/components/BrandMark';
import { cn } from '@/lib/utils';
import { AccountMenu } from './AccountMenu';
import { VerifyBanner } from './VerifyBanner';

function navClass({ isActive }: { isActive: boolean }) {
  return cn(
    'flex flex-1 flex-col items-center justify-center gap-0.5 rounded-md px-2 py-1.5 text-xs transition-colors hover:bg-secondary focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none sm:flex-none sm:flex-row sm:gap-1.5 sm:py-1 sm:text-sm',
    isActive
      ? 'font-medium text-primary sm:bg-secondary sm:text-secondary-foreground'
      : 'text-muted-foreground sm:text-foreground',
  );
}

function NavItem({ to, icon: Icon, label }: { to: string; icon: LucideIcon; label: string }) {
  return (
    <NavLink to={to} viewTransition className={navClass}>
      <Icon aria-hidden="true" className="size-5 sm:size-4" />
      {label}
    </NavLink>
  );
}

export function Layout() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-svh flex-col">
      <header className="app-header relative z-40 border-b border-border bg-surface">
        <div className="mx-auto flex w-full max-w-5xl items-center gap-2 px-4 py-2">
          <Link
            to="/devices"
            viewTransition
            className="flex items-center gap-1.5 rounded-md font-heading font-semibold focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <BrandMark className="size-7" />
            Elec
          </Link>
          <nav
            aria-label={t('app.nav.main')}
            className="fixed inset-x-0 bottom-0 z-40 flex items-stretch gap-1 border-t border-border bg-surface px-2 pt-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] sm:static sm:z-auto sm:flex-1 sm:items-center sm:border-0 sm:bg-transparent sm:p-0"
          >
            <NavItem to="/devices" icon={Cpu} label={t('app.nav.devices')} />
            <NavItem to="/notifications" icon={Bell} label={t('app.nav.notifications')} />
          </nav>
          <div className="ml-auto sm:ml-0">
            <AccountMenu />
          </div>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 p-4 pb-24 sm:pb-4">
        <VerifyBanner />
        <Outlet />
      </main>
    </div>
  );
}
