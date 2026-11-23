import { resetBodySchema } from '@elec/shared/api';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { z } from 'zod';
import { resetPassword } from '@/api/endpoints';
import { isApiError } from '@/api/errors';
import { useSession } from '@/api/session';
import { Button, buttonVariants } from '@/components/ui/button';
import { errorMessage } from '@/forms/errorMessage';
import { FormAlert } from '@/forms/FormAlert';
import { TextField } from '@/forms/TextField';
import { applyServerErrors } from '@/forms/zodErrors';
import { AuthLayout } from './AuthLayout';

const formSchema = resetBodySchema
  .pick({ password: true })
  .extend({ confirm: z.string() })
  .refine((value) => value.password === value.confirm, {
    path: ['confirm'],
    params: { reason: 'password_mismatch' },
  });
type Input = z.input<typeof formSchema>;
type Output = z.output<typeof formSchema>;

export function ResetPasswordPage() {
  const { t } = useTranslation();
  const { api } = useSession();
  const [params] = useSearchParams();
  const token = params.get('token');
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<Input, unknown, Output>({
    resolver: zodResolver(formSchema),
    defaultValues: { password: '', confirm: '' },
  });
  const mutation = useMutation({
    mutationFn: (password: string) => resetPassword(api, { token: token ?? '', password }),
  });

  if (!token || isApiError(mutation.error, 'expired')) {
    return (
      <AuthLayout
        title={t('app.auth.reset.expiredTitle')}
        description={t('app.auth.reset.expiredBody')}
      >
        <Link to="/forgot-password" className={buttonVariants()}>
          {t('app.auth.reset.requestNew')}
        </Link>
      </AuthLayout>
    );
  }

  if (mutation.isSuccess) {
    return (
      <AuthLayout title={t('app.auth.reset.doneTitle')} description={t('app.auth.reset.doneBody')}>
        <Link to="/login" className={buttonVariants()}>
          {t('app.auth.reset.login')}
        </Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title={t('app.auth.reset.title')}>
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={handleSubmit(({ password }) => {
          setFormError(null);
          mutation.mutate(password, {
            onError: (error) => {
              const mapped =
                isApiError(error, 'validation_error') &&
                applyServerErrors(error, setError, ['password'], t);
              if (!mapped) setFormError(errorMessage(t, error));
            },
          });
        })}
      >
        <FormAlert message={formError} />
        <TextField
          label={t('app.auth.newPassword')}
          type="password"
          autoComplete="new-password"
          error={errors.password}
          {...register('password')}
        />
        <TextField
          label={t('app.auth.repeatPassword')}
          type="password"
          autoComplete="new-password"
          error={errors.confirm}
          {...register('confirm')}
        />
        <Button type="submit" disabled={mutation.isPending}>
          {t('app.auth.reset.submit')}
        </Button>
      </form>
    </AuthLayout>
  );
}
