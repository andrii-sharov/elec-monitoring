import { emailSchema } from '@elec/shared/api';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { z } from 'zod';
import { forgotPassword } from '@/api/endpoints';
import { useSession } from '@/api/session';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/forms/errorMessage';
import { FormAlert } from '@/forms/FormAlert';
import { TextField } from '@/forms/TextField';
import { AuthLayout } from './AuthLayout';

const formSchema = z.object({ email: emailSchema });
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
    formState: { errors },
  } = useForm<Input, unknown, Output>({
    resolver: zodResolver(formSchema),
    defaultValues: { email: '' },
  });
  const mutation = useMutation({ mutationFn: (body: Output) => forgotPassword(api, body) });

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
        <TextField
          label={t('app.auth.email')}
          type="email"
          autoComplete="email"
          error={errors.email}
          {...register('email')}
        />
        <Button type="submit" disabled={mutation.isPending}>
          {t('app.auth.forgot.submit')}
        </Button>
      </form>
    </AuthLayout>
  );
}
