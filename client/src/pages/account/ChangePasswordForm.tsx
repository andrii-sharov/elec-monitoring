import { changePasswordBodySchema, passwordSchema } from '@elec/shared/api';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { z } from 'zod';
import { changePassword } from '@/api/endpoints';
import { isApiError } from '@/api/errors';
import { useSession } from '@/api/session';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/forms/errorMessage';
import { FormAlert } from '@/forms/FormAlert';
import { TextField } from '@/forms/TextField';

const formSchema = changePasswordBodySchema
  .extend({ repeat_password: z.string() })
  .superRefine((values, ctx) => {
    if (values.new_password !== values.repeat_password) {
      ctx.addIssue({
        code: 'custom',
        path: ['repeat_password'],
        params: { reason: 'password_mismatch' },
        input: values.repeat_password,
      });
    }
  });

type Values = z.infer<typeof formSchema>;

const emptyValues: Values = { current_password: '', new_password: '', repeat_password: '' };

export function ChangePasswordForm() {
  const { t } = useTranslation();
  const { api } = useSession();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<Values>({ resolver: zodResolver(formSchema), defaultValues: emptyValues });
  const mutation = useMutation({
    mutationFn: ({ current_password, new_password }: Values) =>
      changePassword(api, { current_password, new_password }),
    onMutate: () => setFormError(null),
    onSuccess: () => {
      reset(emptyValues);
      toast.success(t('app.account.passwordChanged'));
    },
    onError: (error) => {
      if (isApiError(error, 'invalid_credentials')) {
        setError('current_password', { type: 'server', message: t('app.account.wrongPassword') });
        return;
      }
      setFormError(errorMessage(t, error));
    },
  });

  return (
    <section aria-labelledby="password-title" className="flex max-w-xl flex-col gap-3">
      <h2 id="password-title" className="font-heading text-lg font-medium">
        {t('app.account.passwordTitle')}
      </h2>
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={handleSubmit((values) => mutation.mutate(values))}
      >
        <FormAlert message={formError} />
        <TextField
          label={t('app.account.currentPassword')}
          type="password"
          autoComplete="current-password"
          error={errors.current_password}
          {...register('current_password')}
        />
        <TextField
          label={t('app.account.newPassword')}
          type="password"
          autoComplete="new-password"
          placeholder={t('app.validation.too_small_string', { min: passwordSchema.minLength })}
          error={errors.new_password}
          {...register('new_password')}
        />
        <TextField
          label={t('app.account.repeatPassword')}
          type="password"
          autoComplete="new-password"
          error={errors.repeat_password}
          {...register('repeat_password')}
        />
        <Button type="submit" className="self-start" disabled={mutation.isPending}>
          {t('app.account.changePassword')}
        </Button>
      </form>
    </section>
  );
}
