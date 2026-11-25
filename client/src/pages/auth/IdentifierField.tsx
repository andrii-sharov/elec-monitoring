import type { FieldValues } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import {
  ControlledPhoneField,
  type ControlledPhoneFieldProps,
} from '@/forms/phone/ControlledPhoneField';

type IdentifierFieldProps<T extends FieldValues> = Omit<
  ControlledPhoneFieldProps<T>,
  'mode' | 'label'
>;

export function IdentifierField<T extends FieldValues>(props: IdentifierFieldProps<T>) {
  const { t } = useTranslation();
  return (
    <ControlledPhoneField mode="identifier" label={t('app.auth.phone.identifier')} {...props} />
  );
}
