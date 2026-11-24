import { BookOpen, ExternalLink, LogOut, UserRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useSession } from '@/api/session';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLinkItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { apiUrl } from '@/lib/config';

function initial(name: string | undefined): string {
  return name?.trim().charAt(0).toUpperCase() || '?';
}

export function AccountMenu() {
  const { t } = useTranslation();
  const { me, signOut } = useSession();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t('app.nav.menu')}
        className="flex items-center gap-2 rounded-full py-1 pr-1 pl-1 text-sm hover:bg-secondary focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none data-popup-open:bg-secondary sm:pr-3"
      >
        <span
          aria-hidden="true"
          className="flex size-7 items-center justify-center rounded-full bg-primary font-medium text-primary-foreground"
        >
          {initial(me?.name)}
        </span>
        <span className="hidden max-w-40 truncate sm:inline">{me?.name}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        <DropdownMenuLinkItem closeOnClick render={<Link to="/account" viewTransition />}>
          <UserRound aria-hidden="true" />
          {t('app.nav.account')}
        </DropdownMenuLinkItem>
        <DropdownMenuLinkItem
          closeOnClick
          href={`${apiUrl()}/api/docs`}
          target="_blank"
          rel="noreferrer"
        >
          <BookOpen aria-hidden="true" />
          {t('app.nav.apiDocs')}
          <ExternalLink aria-hidden="true" className="ml-auto size-3.5 text-muted-foreground" />
        </DropdownMenuLinkItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => void signOut()}>
          <LogOut aria-hidden="true" />
          {t('app.nav.signOut')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
