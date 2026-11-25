import { emailSchema } from '@elec/shared/api';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { z } from 'zod';
import { login } from '@/api/endpoints';
import { useSession } from '@/api/session';
import { Button, buttonVariants } from '@/components/ui/button';
import { errorMessage } from '@/forms/errorMessage';
import { FormAlert } from '@/forms/FormAlert';
import { TextField } from '@/forms/TextField';
import { safeNext } from '@/lib/safeNext';
import { AuthLayout } from './AuthLayout';
import { GoogleButton } from './GoogleButton';

const formSchema = z.object({ email: emailSchema, password: z.string().min(1).max(128) });
type Input = z.input<typeof formSchema>;
type Output = z.output<typeof formSchema>;

export function LoginPage() {
  const { t } = useTranslation();
  const { api, signedIn } = useSession();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<Input, unknown, Output>({
    resolver: zodResolver(formSchema),
    defaultValues: { email: params.get('email') ?? '', password: '' },
  });
  const mutation = useMutation({
    mutationFn: (body: Output) => login(api, body),
    onSuccess: signedIn,
  });

  return (
    <AuthLayout
      title={t('app.auth.login.title')}
      description={t('app.auth.login.description')}
      footer={
        <>
          {t('app.auth.login.noAccount')}{' '}
          <Link to="/signup" className="text-primary underline-offset-4 hover:underline">
            {t('app.auth.login.signup')}
          </Link>
        </>
      }
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
        <TextField
          label={t('app.auth.password')}
          type="password"
          autoComplete="current-password"
          error={errors.password}
          {...register('password')}
        />
        <Button type="submit" disabled={mutation.isPending}>
          {t('app.auth.login.submit')}
        </Button>
        <Link to="/forgot-password" className={buttonVariants({ variant: 'link', size: 'sm' })}>
          {t('app.auth.login.forgot')}
        </Link>
      </form>
      <GoogleButton next={next} />
    </AuthLayout>
  );
}
