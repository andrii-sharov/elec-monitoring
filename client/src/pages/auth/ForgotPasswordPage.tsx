import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { z } from 'zod';
import { forgotPassword } from '@/api/endpoints';
import { isApiError } from '@/api/errors';
import { useSession } from '@/api/session';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/forms/errorMessage';
import { FormAlert } from '@/forms/FormAlert';
import { applyServerErrors } from '@/forms/zodErrors';
import { AuthLayout } from './AuthLayout';
import { identifierErrors, identifierValueSchema, toIdentifier } from './identifier';
import { IdentifierField } from './IdentifierField';
import { TelegramConfirm } from './TelegramConfirm';

const formSchema = z.object({ identifier: identifierValueSchema });
type Input = z.input<typeof formSchema>;
type Output = z.output<typeof formSchema>;

const backLink = (label: string) => (
  <Link to="/login" className="text-primary underline-offset-4 hover:underline">
    {label}
  </Link>
);

export function ForgotPasswordPage() {
  const { t } = useTranslation();
  const { api } = useSession();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<Input, unknown, Output>({
    resolver: zodResolver(formSchema),
    defaultValues: { identifier: '' },
  });
  const mutation = useMutation({
    mutationFn: ({ identifier }: Output) => forgotPassword(api, toIdentifier(identifier)),
    onError: (error) => {
      if (isApiError(error, 'validation_error')) {
        applyServerErrors(identifierErrors(error), setError, ['identifier'], t);
      }
    },
  });

  if (mutation.isSuccess && mutation.data) {
    return (
      <AuthLayout title={t('app.auth.forgot.title')} footer={backLink(t('app.auth.backToLogin'))}>
        <TelegramConfirm
          url={mutation.data.telegram_url}
          title={t('app.auth.phone.forgotTitle')}
          hint={t('app.auth.phone.forgotHint')}
        />
      </AuthLayout>
    );
  }

  if (mutation.isSuccess) {
    return (
      <AuthLayout
        title={t('app.auth.forgot.sentTitle')}
        footer={backLink(t('app.auth.backToLogin'))}
      >
        <p className="text-sm text-muted-foreground">{t('app.auth.forgot.sentBody')}</p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title={t('app.auth.forgot.title')}
      description={t('app.auth.forgot.description')}
      footer={backLink(t('app.auth.backToLogin'))}
    >
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={handleSubmit((values) => mutation.mutate(values))}
      >
        <FormAlert message={mutation.error ? errorMessage(t, mutation.error) : null} />
        <IdentifierField error={errors.identifier} {...register('identifier')} />
        <Button type="submit" disabled={mutation.isPending}>
          {t('app.auth.forgot.submit')}
        </Button>
      </form>
    </AuthLayout>
  );
}
