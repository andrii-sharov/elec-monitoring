import type { ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import { TextField } from '@/forms/TextField';

type IdentifierFieldProps = Omit<ComponentProps<typeof TextField>, 'label' | 'type'>;

export function IdentifierField(props: IdentifierFieldProps) {
  const { t } = useTranslation();
  return <TextField label={t('app.auth.phone.identifier')} autoComplete="username" {...props} />;
}
