import type { InvitePreview } from '@elec/shared/api';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { acceptInvite } from '@/api/endpoints';
import { isApiError } from '@/api/errors';
import { queryKeys, useInvitePreview } from '@/api/queries';
import { useSession } from '@/api/session';
import { Button, buttonVariants } from '@/components/ui/button';
import { errorMessage } from '@/forms/errorMessage';
import { FormAlert } from '@/forms/FormAlert';
import { AuthLayout } from '../auth/AuthLayout';
import { GoogleButton } from '../auth/GoogleButton';

export function InvitePage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const token = params.get('token');
  const preview = useInvitePreview(token);
  const { status, me } = useSession();
  const accept = useAcceptInvite(token);

  if (!token || isApiError(preview.error, 'expired') || isApiError(accept.error, 'expired')) {
    return (
      <AuthLayout title={t('app.invite.expiredTitle')} description={t('app.invite.expiredBody')} />
    );
  }

  if (preview.error) {
    return (
      <AuthLayout title={t('app.invite.loading')}>
        <FormAlert message={errorMessage(t, preview.error)} />
      </AuthLayout>
    );
  }

  if (!preview.data || status === 'loading') {
    return <AuthLayout title={t('app.invite.loading')} />;
  }

  const invite = preview.data;
  const here = `/invite?${new URLSearchParams({ token }).toString()}`;

  if (status !== 'authenticated' || !me) {
    return <SignedOut invite={invite} next={here} />;
  }

  if (me.email.toLowerCase() !== invite.email || isApiError(accept.error, 'forbidden')) {
    return <WrongAccount invite={invite} current={me.email} />;
  }

  return (
    <AuthLayout
      title={t('app.invite.title', { inviter: invite.inviter_name, device: invite.device_name })}
      description={t('app.invite.body')}
    >
      <FormAlert message={accept.error ? errorMessage(t, accept.error) : null} />
      <Button onClick={() => accept.mutate()} disabled={accept.isPending}>
        {invite.accepted ? t('app.invite.open') : t('app.invite.accept')}
      </Button>
    </AuthLayout>
  );
}

function useAcceptInvite(token: string | null) {
  const { t } = useTranslation();
  const { api } = useSession();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: () => acceptInvite(api, token!),
    onSuccess: (device) => {
      queryClient.setQueryData(queryKeys.device(device.id), device);
      void queryClient.invalidateQueries({ queryKey: queryKeys.devices });
      void queryClient.invalidateQueries({ queryKey: queryKeys.me });
      toast.success(t('app.invite.accepted', { device: device.name }));
      void navigate(`/devices/${device.id}`);
    },
  });
}

function SignedOut({ invite, next }: { invite: InvitePreview; next: string }) {
  const { t } = useTranslation();
  const signup = new URLSearchParams({ email: invite.email, invite: '1' });
  const login = new URLSearchParams({ email: invite.email, next });
  return (
    <AuthLayout
      title={t('app.invite.title', { inviter: invite.inviter_name, device: invite.device_name })}
      description={t('app.invite.body')}
    >
      <p className="text-sm text-muted-foreground">
        {t('app.invite.forEmail', { email: invite.email })}
      </p>
      <Link to={`/signup?${signup.toString()}`} className={buttonVariants()}>
        {t('app.invite.createAccount')}
      </Link>
      <Link to={`/login?${login.toString()}`} className={buttonVariants({ variant: 'outline' })}>
        {t('app.invite.login')}
      </Link>
      <GoogleButton next={next} />
    </AuthLayout>
  );
}

function WrongAccount({ invite, current }: { invite: InvitePreview; current: string }) {
  const { t } = useTranslation();
  const { signOut } = useSession();
  return (
    <AuthLayout
      title={t('app.invite.wrongAccountTitle')}
      description={t('app.invite.wrongAccountBody', { email: invite.email, current })}
    >
      <Button variant="outline" onClick={() => void signOut()}>
        {t('app.invite.signOut')}
      </Button>
    </AuthLayout>
  );
}
