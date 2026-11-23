import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useSession } from '@/api/session';
import { buttonVariants } from '@/components/ui/button';
import { takeGoogleState } from '@/lib/google';
import { AuthLayout } from './AuthLayout';

const knownErrors = [
  'google_failed',
  'google_email_unverified',
  'google_account_in_use',
  'google_already_linked',
] as const;

export function GoogleCallbackPage() {
  const { t } = useTranslation();
  const { status } = useSession();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const error = params.get('error');
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    if (error) {
      handled.current = true;
      takeGoogleState();
      return;
    }
    if (status === 'loading') return;
    handled.current = true;
    const state = takeGoogleState();
    void navigate(status === 'authenticated' ? (state?.next ?? '/devices') : '/login', {
      replace: true,
    });
  }, [error, status, navigate]);

  if (error) {
    const key = knownErrors.find((known) => known === error) ?? 'google_failed';
    return (
      <AuthLayout title={t('app.auth.google.title')}>
        <p role="alert" className="text-sm text-destructive">
          {t(`app.google.errors.${key}`)}
        </p>
        <Link to="/login" className={buttonVariants()}>
          {t('app.auth.backToLogin')}
        </Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title={t('app.auth.google.title')}>
      <p className="text-sm text-muted-foreground">{t('app.auth.google.working')}</p>
    </AuthLayout>
  );
}
