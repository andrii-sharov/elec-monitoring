import { Mail, Phone } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

type Kind = 'empty' | 'email' | 'phone';

function Word({
  active,
  dimmed,
  icon: Icon,
  children,
}: {
  active: boolean;
  dimmed: boolean;
  icon: typeof Mail;
  children: string;
}) {
  return (
    <span
      data-active={active || undefined}
      className={cn(
        'relative inline-flex items-center gap-1 transition-[color,opacity,text-shadow] duration-(--app-motion-duration) ease-(--app-motion-ease)',
        'after:absolute after:inset-x-0 after:-bottom-1 after:h-0.5 after:origin-left after:scale-x-0 after:rounded-full after:bg-primary after:transition-transform after:duration-(--app-motion-duration) after:ease-(--app-motion-ease)',
        active &&
          'text-primary [text-shadow:0_0_14px_color-mix(in_oklab,var(--primary)_60%,transparent)] after:scale-x-100',
        dimmed && 'opacity-45',
      )}
    >
      <Icon
        aria-hidden="true"
        className={cn(
          'size-3.5 transition-[filter] duration-(--app-motion-duration)',
          active && 'drop-shadow-[0_0_6px_color-mix(in_oklab,var(--primary)_70%,transparent)]',
        )}
      />
      {children}
    </span>
  );
}

export function IdentifierWords({ kind }: { kind: Kind }) {
  const { t } = useTranslation();
  return (
    <>
      <span data-kind={kind} className="inline-flex items-center gap-2">
        <Word active={kind === 'email'} dimmed={kind === 'phone'} icon={Mail}>
          {t('app.auth.phone.identifierWords.email')}
        </Word>
        <span className="text-muted-foreground">{t('app.auth.phone.identifierWords.or')}</span>
        <Word active={kind === 'phone'} dimmed={kind === 'email'} icon={Phone}>
          {t('app.auth.phone.identifierWords.phone')}
        </Word>
      </span>
    </>
  );
}
