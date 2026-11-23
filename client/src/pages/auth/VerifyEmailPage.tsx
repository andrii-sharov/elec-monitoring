import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { resendVerification, verifyEmail } from '@/api/endpoints';
import { isApiError } from '@/api/errors';
import { queryKeys } from '@/api/queries';
import { useSession } from '@/api/session';
import { Button, buttonVariants } from '@/components/ui/button';
import { errorMessage } from '@/forms/errorMessage';
import { FormAlert } from '@/forms/FormAlert';
import { AuthLayout } from './AuthLayout';

export function VerifyEmailPage() {
  const { t } = useTranslation();
  const { api, status } = useSession();
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const token = params.get('token');
  const started = useRef(false);
  const verify = useMutation({
    mutationFn: (value: string) => verifyEmail(api, { token: value }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.me }),
  });
  const resend = useMutation({
    mutationFn: () => resendVerification(api),
    onSuccess: () => toast.success(t('app.auth.verify.resent')),
    onError: (error) => toast.error(errorMessage(t, error)),
  });
  const { mutate } = verify;

  useEffect(() => {
    if (started.current || !token) return;
    started.current = true;
    mutate(token);
  }, [token, mutate]);

  const ready = status !== 'loading';
  const signedIn = status === 'authenticated';
  const expired = !token || isApiError(verify.error, 'expired');

  if (verify.isSuccess) {
    return (
      <AuthLayout
        title={t('app.auth.verify.successTitle')}
        description={t('app.auth.verify.successBody')}
      >
        {ready ? (
          <Link to={signedIn ? '/devices' : '/login'} className={buttonVariants()}>
            {signedIn ? t('app.auth.verify.goToDevices') : t('app.auth.verify.login')}
          </Link>
        ) : null}
      </AuthLayout>
    );
  }

  if (expired) {
    return (
      <AuthLayout
        title={t('app.auth.verify.expiredTitle')}
        description={t('app.auth.verify.expiredBody')}
      >
        {ready && signedIn ? (
          <Button onClick={() => resend.mutate()} disabled={resend.isPending}>
            {t('app.auth.verify.resend')}
          </Button>
        ) : null}
        {ready && !signedIn ? (
          <Link to="/login" className={buttonVariants()}>
            {t('app.auth.verify.login')}
          </Link>
        ) : null}
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title={t('app.auth.verify.loading')}>
      <FormAlert message={verify.error ? errorMessage(t, verify.error) : null} />
    </AuthLayout>
  );
}
