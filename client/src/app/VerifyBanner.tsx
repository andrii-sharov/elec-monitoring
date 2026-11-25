import { MailWarning, MessageCircleWarning } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { addPhone, resendVerification } from '@/api/endpoints';
import { useSession } from '@/api/session';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { errorMessage } from '@/forms/errorMessage';

export function VerifyBanner() {
  const { t } = useTranslation();
  const { api, me } = useSession();
  const resend = useMutation({
    mutationFn: () => resendVerification(api),
    onSuccess: () => toast.success(t('app.verify.resent')),
    onError: (error) => toast.error(errorMessage(t, error)),
  });
  const confirm = useMutation({
    mutationFn: (phone: string) => addPhone(api, phone),
    onSuccess: ({ telegram_url }) => window.open(telegram_url, '_blank', 'noopener,noreferrer'),
    onError: (error) => toast.error(errorMessage(t, error)),
  });
  if (!me || me.email_verified || me.phone_verified) return null;
  if (!me.email && me.phone) {
    const phone = me.phone;
    return (
      <Alert className="flex flex-wrap items-center justify-between gap-2">
        <AlertDescription className="flex items-center gap-2">
          <MessageCircleWarning aria-hidden="true" className="size-4 flex-none" />
          {t('app.auth.phone.banner')}
        </AlertDescription>
        {confirm.data ? (
          <a
            href={confirm.data.telegram_url}
            target="_blank"
            rel="noreferrer"
            className={buttonVariants({ size: 'sm' })}
          >
            {t('app.auth.phone.openTelegram')}
          </a>
        ) : (
          <Button size="sm" onClick={() => confirm.mutate(phone)} disabled={confirm.isPending}>
            {t('app.auth.phone.bannerAction')}
          </Button>
        )}
      </Alert>
    );
  }
  return (
    <Alert className="flex flex-wrap items-center justify-between gap-2">
      <AlertDescription className="flex items-center gap-2">
        <MailWarning aria-hidden="true" className="size-4 flex-none" />
        {t('app.verify.banner')}
      </AlertDescription>
      <Button size="sm" onClick={() => resend.mutate()} disabled={resend.isPending}>
        {t('app.verify.resend')}
      </Button>
    </Alert>
  );
}
