import type { Me } from '@elec/shared/api';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { unlinkGoogle } from '@/api/endpoints';
import { isApiError } from '@/api/errors';
import { queryKeys } from '@/api/queries';
import { useSession } from '@/api/session';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/forms/errorMessage';
import { FormAlert } from '@/forms/FormAlert';
import { startGoogle } from '@/lib/google';

export function SignInMethods({ me }: { me: Me }) {
  const { t } = useTranslation();
  const { api } = useSession();
  const queryClient = useQueryClient();
  const unlink = useMutation({
    mutationFn: () => unlinkGoogle(api),
    onSuccess: () => {
      queryClient.setQueryData(queryKeys.me, { ...me, google_linked: false });
      toast.success(t('app.account.unlinked'));
    },
  });
  const failure = unlink.error
    ? isApiError(unlink.error, 'conflict')
      ? t('app.account.unlinkNeedsPassword')
      : errorMessage(t, unlink.error)
    : null;

  return (
    <section aria-labelledby="methods-title" className="flex max-w-xl flex-col gap-3">
      <h2 id="methods-title" className="font-heading text-lg font-medium">
        {t('app.account.methods')}
      </h2>
      <FormAlert message={failure} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>
          {me.google_linked ? t('app.account.googleLinked') : t('app.account.googleNotLinked')}
        </span>
        {me.google_linked ? (
          <Button variant="outline" disabled={unlink.isPending} onClick={() => unlink.mutate()}>
            {t('app.account.unlink')}
          </Button>
        ) : me.email_verified || me.phone_verified ? (
          <Button variant="outline" onClick={() => startGoogle('LINK', '/account')}>
            {t('app.account.link')}
          </Button>
        ) : null}
      </div>
    </section>
  );
}
