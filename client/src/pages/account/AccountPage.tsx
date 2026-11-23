import { useTranslation } from 'react-i18next';
import { Skeleton } from '@/components/ui/skeleton';
import { useSession } from '@/api/session';
import { ChangePasswordForm } from './ChangePasswordForm';
import { DeleteAccount } from './DeleteAccount';
import { ProfileForm } from './ProfileForm';
import { SessionsCard } from './SessionsCard';
import { SignInMethods } from './SignInMethods';

export function AccountPage() {
  const { t } = useTranslation();
  const { me } = useSession();

  return (
    <div className="flex flex-col gap-8">
      <h1 className="font-heading text-2xl font-semibold">{t('app.account.title')}</h1>
      {me ? (
        <>
          <ProfileForm key={me.id} me={me} />
          <SignInMethods me={me} />
          {me.has_password ? <ChangePasswordForm /> : null}
          <SessionsCard />
          <DeleteAccount me={me} />
        </>
      ) : (
        <output aria-label={t('app.common.loading')} className="flex flex-col gap-3">
          <Skeleton className="h-24 w-full" />
        </output>
      )}
    </div>
  );
}
