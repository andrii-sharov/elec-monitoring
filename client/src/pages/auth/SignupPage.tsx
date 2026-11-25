import { emailSchema, nameSchema, passwordSchema } from '@elec/shared/api';
import { languages, type Language } from '@elec/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { z } from 'zod';
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
import { TelegramConfirm } from './TelegramConfirm';

const shared = { password: passwordSchema, name: nameSchema };
const formSchemas = {
  email: z.object({ email: emailSchema, phone: z.string(), ...shared }),
  phone: z.object({ email: z.string(), phone: z.string().trim().min(1), ...shared }),
};
type Method = keyof typeof formSchemas;
type Input = z.input<typeof formSchemas.email>;
type Output = z.output<typeof formSchemas.email>;

const methods: Method[] = ['email', 'phone'];
const fields = ['email', 'phone', 'password', 'name'] as const;
const fallbackTimezone = 'Europe/Kyiv';

function browserTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || fallbackTimezone;
}

export function SignupPage() {
  const { t, i18n } = useTranslation();
  const { api } = useSession();
  const [params] = useSearchParams();
  const fromInvite = params.get('invite') === '1';
  const [method, setMethod] = useState<Method>(params.get('phone') ? 'phone' : 'email');
  const language: Language = languages.find((l) => l === i18n.resolvedLanguage) ?? 'uk';
  const {
    register,
    handleSubmit,
    setError,
    clearErrors,
    formState: { errors },
  } = useForm<Input, unknown, Output>({
    resolver: zodResolver(formSchemas[method]),
    defaultValues: {
      email: params.get('email') ?? '',
      phone: params.get('phone') ?? '',
      password: '',
      name: '',
    },
  });
  const mutation = useMutation({
    mutationFn: ({ email, phone, password, name }: Output) =>
      signup(api, {
        ...(method === 'phone' ? { phone } : { email }),
        password,
        name,
        language,
        timezone: browserTimezone(),
      }),
  });
  const [formError, setFormError] = useState<string | null>(null);
  const submittedEmail = mutation.variables?.email ?? '';

  if (mutation.isSuccess && mutation.data) {
    return (
      <AuthLayout
        title={t('app.auth.signup.title')}
        footer={
          <Link to="/login" className="text-primary underline-offset-4 hover:underline">
            {t('app.auth.backToLogin')}
          </Link>
        }
      >
        <TelegramConfirm
          url={mutation.data.telegram_url}
          title={t('app.auth.phone.confirmTitle')}
          hint={t('app.auth.phone.confirmHint')}
        />
        {fromInvite ? (
          <p className="text-sm text-muted-foreground">{t('app.auth.phone.inviteNote')}</p>
        ) : null}
      </AuthLayout>
    );
  }

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
        {fromInvite ? (
          <p className="text-sm text-muted-foreground">{t('app.auth.signup.inviteNote')}</p>
        ) : null}
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
        <fieldset className="grid grid-cols-2 gap-2">
          {methods.map((option) => (
            <Button
              key={option}
              type="button"
              variant={method === option ? 'default' : 'outline'}
              aria-pressed={method === option}
              onClick={() => {
                setMethod(option);
                clearErrors();
              }}
            >
              {t(option === 'email' ? 'app.auth.email' : 'app.auth.phone.tab')}
            </Button>
          ))}
        </fieldset>
        <TextField
          label={t('app.auth.name')}
          autoComplete="name"
          error={errors.name}
          {...register('name')}
        />
        {method === 'email' ? (
          <TextField
            key="email"
            label={t('app.auth.email')}
            type="email"
            autoComplete="email"
            error={errors.email}
            {...register('email')}
          />
        ) : (
          <TextField
            key="phone"
            label={t('app.auth.phone.number')}
            type="tel"
            autoComplete="tel"
            error={errors.phone}
            {...register('phone')}
          />
        )}
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
