import { nameSchema, passwordSchema } from '@elec/shared/api';
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
import { identifierErrors, identifierValueSchema, toIdentifier } from './identifier';
import { IdentifierField } from './IdentifierField';
import { TelegramConfirm } from './TelegramConfirm';

const formSchema = z.object({
  identifier: identifierValueSchema,
  password: passwordSchema,
  name: nameSchema,
});
type Input = z.input<typeof formSchema>;
type Output = z.output<typeof formSchema>;

const fields = ['identifier', 'password', 'name'] as const;
const fallbackTimezone = 'Europe/Kyiv';

function browserTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || fallbackTimezone;
}

export function SignupPage() {
  const { t, i18n } = useTranslation();
  const { api } = useSession();
  const [params] = useSearchParams();
  const fromInvite = params.get('invite') === '1';
  const language: Language = languages.find((l) => l === i18n.resolvedLanguage) ?? 'uk';
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<Input, unknown, Output>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      identifier: params.get('email') ?? params.get('phone') ?? '',
      password: '',
      name: '',
    },
  });
  const mutation = useMutation({
    mutationFn: ({ identifier, password, name }: Output) =>
      signup(api, {
        ...toIdentifier(identifier),
        password,
        name,
        language,
        timezone: browserTimezone(),
      }),
  });
  const [formError, setFormError] = useState<string | null>(null);
  const submittedEmail = mutation.variables?.identifier ?? '';

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
                applyServerErrors(identifierErrors(error), setError, fields, t);
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
        <IdentifierField control={control} name="identifier" />
        <TextField
          label={t('app.auth.password')}
          type="password"
          autoComplete="new-password"
          placeholder={t('app.validation.too_small_string', { min: passwordSchema.minLength })}
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
