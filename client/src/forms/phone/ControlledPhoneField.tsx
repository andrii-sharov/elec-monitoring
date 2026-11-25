import type { Control, FieldPathByValue, FieldValues } from 'react-hook-form';
import { useController } from 'react-hook-form';
import { PhoneTextField, type PhoneTextFieldProps } from './PhoneTextField';

export type ControlledPhoneFieldProps<T extends FieldValues> = Pick<
  PhoneTextFieldProps,
  'mode' | 'label' | 'disabled' | 'autoComplete' | 'placeholder'
> & {
  control: Control<T>;
  name: FieldPathByValue<T, string>;
};

export function ControlledPhoneField<T extends FieldValues>({
  control,
  name,
  ...props
}: ControlledPhoneFieldProps<T>) {
  const { field, fieldState } = useController({ control, name });
  return (
    <PhoneTextField {...field} {...props} value={field.value as string} error={fieldState.error} />
  );
}
