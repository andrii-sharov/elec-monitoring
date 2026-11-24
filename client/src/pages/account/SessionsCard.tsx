import { MonitorSmartphone } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { logoutAll } from '@/api/endpoints';
import { useSession } from '@/api/session';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/forms/errorMessage';
import { FormAlert } from '@/forms/FormAlert';

export function SessionsCard() {
  const { t } = useTranslation();
  const { api, signOut, endSession } = useSession();
  const everywhere = useMutation({
    mutationFn: () => logoutAll(api),
    onSuccess: endSession,
  });

  return (
    <section aria-labelledby="sessions-title" className="flex max-w-xl flex-col gap-3">
      <h2 id="sessions-title" className="flex items-center gap-2 font-heading text-lg font-medium">
        <MonitorSmartphone aria-hidden="true" className="size-4" />
        {t('app.account.sessions')}
      </h2>
      <FormAlert message={everywhere.error ? errorMessage(t, everywhere.error) : null} />
      <p className="text-sm text-muted-foreground">{t('app.account.logoutAllBody')}</p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => void signOut()}>
          {t('app.account.logout')}
        </Button>
        <Button
          variant="outline"
          disabled={everywhere.isPending}
          onClick={() => everywhere.mutate()}
        >
          {t('app.account.logoutAll')}
        </Button>
      </div>
    </section>
  );
}
