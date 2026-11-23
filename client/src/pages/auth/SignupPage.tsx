import { signupBodySchema } from '@elec/shared/api';
import { languages, type Language } from '@elec/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { z } from 'zod';
import { signup } from '@/api/endpoints';
import { isApiError } from '@/api/errors';
import { useSession } from '@/api/session';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/forms/errorMessage';
import { FormAlert } from '@/forms/FormAlert';
import { TextField } from '@/forms/TextField';
import { applyServerErrors } from '@/forms/zodErrors';
import { AuthLayout } from './AuthLayout';
import { GoogleButton } from './GoogleButton';

const formSchema = signupBodySchema.pick({ email: true, password: true, name: true });
type Input = z.input<typeof formSchema>;
type Output = z.output<typeof formSchema>;

const fields = ['email', 'password', 'name'] as const;
const fallbackTimezone = 'Europe/Kyiv';

function browserTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || fallbackTimezone;
}

export function SignupPage() {
  const { t, i18n } = useTranslation();
  const { api } = useSession();
  const language: Language = languages.find((l) => l === i18n.resolvedLanguage) ?? 'uk';
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<Input, unknown, Output>({
    resolver: zodResolver(formSchema),
    defaultValues: { email: '', password: '', name: '' },
  });
  const mutation = useMutation({
    mutationFn: (values: Output) =>
      signup(api, { ...values, language, timezone: browserTimezone() }),
  });
  const [formError, setFormError] = useState<string | null>(null);
  const submittedEmail = mutation.variables?.email ?? '';

  if (mutation.isSuccess) {
    return (
      <AuthLayout
        title={t('app.auth.signup.checkEmailTitle')}
        footer={
          <Link to="/login" className="text-primary underline-offset-4 hover:underline">
            {t('app.auth.backToLogin')}
          </Link>
        }
      >
        <p className="text-sm text-muted-foreground">
          {t('app.auth.signup.checkEmailBody', { email: submittedEmail })}
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title={t('app.auth.signup.title')}
      description={t('app.auth.signup.description')}
      footer={
        <>
          {t('app.auth.signup.haveAccount')}{' '}
          <Link to="/login" className="text-primary underline-offset-4 hover:underline">
            {t('app.auth.signup.login')}
          </Link>
        </>
      }
    >
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={handleSubmit((values) => {
          setFormError(null);
          mutation.mutate(values, {
            onError: (error) => {
              const mapped =
                isApiError(error, 'validation_error') &&
                applyServerErrors(error, setError, fields, t);
              if (!mapped) setFormError(errorMessage(t, error));
            },
          });
        })}
      >
        <FormAlert message={formError} />
        <TextField
          label={t('app.auth.name')}
          autoComplete="name"
          error={errors.name}
          {...register('name')}
        />
        <TextField
          label={t('app.auth.email')}
          type="email"
          autoComplete="email"
          error={errors.email}
          {...register('email')}
        />
        <TextField
          label={t('app.auth.password')}
          type="password"
          autoComplete="new-password"
          error={errors.password}
          {...register('password')}
        />
        <Button type="submit" disabled={mutation.isPending}>
          {t('app.auth.signup.submit')}
        </Button>
      </form>
      <GoogleButton />
    </AuthLayout>
  );
}
