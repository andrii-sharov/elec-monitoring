import { emailSchema, type Me } from '@elec/shared/api';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { addEmail, addPhone } from '@/api/endpoints';
import { isApiError } from '@/api/errors';
import { queryKeys } from '@/api/queries';
import { useSession } from '@/api/session';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/forms/errorMessage';
import { FormAlert } from '@/forms/FormAlert';
import { ControlledPhoneField } from '@/forms/phone/ControlledPhoneField';
import { storedPhone } from '@/forms/phone/phoneText';
import { TextField } from '@/forms/TextField';
import { applyServerErrors } from '@/forms/zodErrors';
import { phoneValueSchema } from '../auth/identifier';
import { TelegramConfirm } from '../auth/TelegramConfirm';

type Kind = 'email' | 'phone';

const formSchemas = {
  email: z.object({ value: emailSchema }),
  phone: z.object({ value: phoneValueSchema }),
};
type Values = z.input<typeof formSchemas.email>;

export function Identifiers({ me }: { me: Me }) {
  const { t } = useTranslation();
  const [adding, setAdding] = useState<Kind | null>(null);
  const [emailSent, setEmailSent] = useState(false);
  const [telegramUrl, setTelegramUrl] = useState<string | null>(null);
  const canAdd = me.email_verified || me.phone_verified;

  const row = (kind: Kind, value: string | null, verified: boolean) => (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground">{t(`app.account.identifiers.${kind}`)}</span>
        <span>
          {value && kind === 'phone'
            ? storedPhone(value)
            : (value ?? t('app.account.identifiers.notAdded'))}
        </span>
        {value ? (
          <Badge variant={verified ? 'secondary' : 'outline'}>
            {t(`app.account.identifiers.${verified ? 'confirmed' : 'notConfirmed'}`)}
          </Badge>
        ) : null}
      </span>
      {!value && canAdd && adding !== kind ? (
        <Button variant="outline" onClick={() => setAdding(kind)}>
          {t(`app.account.identifiers.${kind === 'email' ? 'addEmail' : 'addPhone'}`)}
        </Button>
      ) : null}
    </div>
  );

  return (
    <section aria-labelledby="identifiers-title" className="flex max-w-xl flex-col gap-3">
      <h2 id="identifiers-title" className="font-heading text-lg font-medium">
        {t('app.account.identifiers.title')}
      </h2>
      {row('email', me.email, me.email_verified)}
      {row('phone', me.phone, me.phone_verified)}
      {adding === 'email' && !emailSent && !me.email ? (
        <AddForm kind="email" onAdded={() => setEmailSent(true)} />
      ) : null}
      {adding === 'phone' && !telegramUrl && !me.phone ? (
        <AddForm kind="phone" onAdded={setTelegramUrl} />
      ) : null}
      {emailSent ? (
        <p className="text-sm text-muted-foreground">{t('app.account.identifiers.checkInbox')}</p>
      ) : null}
      {telegramUrl && !me.phone ? (
        <TelegramConfirm
          url={telegramUrl}
          title={t('app.auth.phone.confirmTitle')}
          hint={t('app.auth.phone.confirmHint')}
        />
      ) : null}
    </section>
  );
}

function AddForm({ kind, onAdded }: { kind: Kind; onAdded: (telegramUrl: string) => void }) {
  const { t } = useTranslation();
  const { api } = useSession();
  const queryClient = useQueryClient();
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<Values>({
    resolver: zodResolver(formSchemas[kind]),
    defaultValues: { value: '' },
  });
  const add = useMutation({
    mutationFn: async (value: string) => {
      if (kind === 'phone') return (await addPhone(api, value)).telegram_url;
      await addEmail(api, value);
      return '';
    },
    onSuccess: (telegramUrl) => {
      onAdded(telegramUrl);
      return queryClient.invalidateQueries({ queryKey: queryKeys.me });
    },
    onError: (error) => {
      if (!isApiError(error)) return;
      const details = error.details.map((detail) => ({ ...detail, path: 'value' }));
      applyServerErrors({ details }, setError, ['value'], t);
    },
  });
  const formError =
    add.error && !(isApiError(add.error) && add.error.details.length > 0)
      ? errorMessage(t, add.error)
      : null;

  return (
    <form
      noValidate
      className="flex flex-col gap-3"
      onSubmit={handleSubmit(({ value }) => add.mutate(value))}
    >
      <FormAlert message={formError} />
      {kind === 'email' ? (
        <TextField
          label={t('app.auth.email')}
          type="email"
          autoComplete="email"
          error={errors.value}
          {...register('value')}
        />
      ) : (
        <ControlledPhoneField
          mode="phone"
          label={t('app.auth.phone.number')}
          control={control}
          name="value"
        />
      )}
      <Button type="submit" className="self-start" disabled={add.isPending}>
        {t('app.account.identifiers.submit')}
      </Button>
    </form>
  );
}
