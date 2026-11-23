import type { Me } from '@elec/shared/api';
import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { deleteMe } from '@/api/endpoints';
import { isApiError } from '@/api/errors';
import { useSession } from '@/api/session';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { errorMessage } from '@/forms/errorMessage';
import { FormAlert } from '@/forms/FormAlert';
import { TextField } from '@/forms/TextField';
import { startGoogle } from '@/lib/google';

export function DeleteAccount({ me }: { me: Me }) {
  const { t } = useTranslation();
  const { api, endSession } = useSession();
  const [params] = useSearchParams();
  const [open, setOpen] = useState(params.get('confirmDelete') === '1');
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const remove = useMutation({
    mutationFn: () => deleteMe(api, me.has_password ? { password } : {}),
    onMutate: () => setPasswordError(null),
    onSuccess: () => {
      endSession();
      toast.success(t('app.account.deleted'));
    },
    onError: (error) => {
      if (me.has_password && isApiError(error, 'invalid_credentials')) {
        setPasswordError(t('app.account.wrongPassword'));
      }
    },
  });
  const reauth = isApiError(remove.error, 'reauth_required');
  const failure = remove.error && !reauth && !passwordError ? errorMessage(t, remove.error) : null;

  function changeOpen(next: boolean) {
    setOpen(next);
    if (next) return;
    setPassword('');
    setPasswordError(null);
    remove.reset();
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (me.has_password && password === '') {
      setPasswordError(t('app.validation.required'));
      return;
    }
    remove.mutate();
  }

  return (
    <section aria-labelledby="delete-title" className="flex max-w-xl flex-col gap-3">
      <h2 id="delete-title" className="font-heading text-lg font-medium text-danger">
        {t('app.account.deleteTitle')}
      </h2>
      <p className="text-sm text-muted-foreground">{t('app.account.deleteBody')}</p>
      <Dialog open={open} onOpenChange={changeOpen}>
        <DialogTrigger render={<Button variant="destructive" className="self-start" />}>
          {t('app.account.deleteTitle')}
        </DialogTrigger>
        <DialogContent>
          <form noValidate className="flex flex-col gap-4" onSubmit={submit}>
            <DialogHeader>
              <DialogTitle>{t('app.account.deleteTitle')}</DialogTitle>
              <DialogDescription>{t('app.account.deleteBody')}</DialogDescription>
            </DialogHeader>
            <FormAlert message={failure} />
            {me.has_password ? (
              <TextField
                label={t('app.account.deletePassword')}
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                error={passwordError ? { type: 'server', message: passwordError } : undefined}
              />
            ) : null}
            {reauth ? (
              <div role="alert" className="flex flex-col gap-2 text-sm text-danger">
                <p>{t('app.account.deleteReauth')}</p>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => startGoogle('LOGIN', '/account?confirmDelete=1')}
                >
                  {t('app.account.signInGoogleAgain')}
                </Button>
              </div>
            ) : null}
            <DialogFooter>
              <Button type="submit" variant="destructive" disabled={remove.isPending}>
                {t('app.account.deleteConfirm')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
