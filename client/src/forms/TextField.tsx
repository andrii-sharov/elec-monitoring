import type { ComponentProps } from 'react';
import { useId } from 'react';
import type { FieldError as HookFormError } from 'react-hook-form';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

type TextFieldProps = Omit<ComponentProps<typeof Input>, 'id'> & {
  label: string;
  error?: HookFormError | undefined;
};

export function TextField({ label, error, ...props }: TextFieldProps) {
  const id = useId();
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input id={id} aria-invalid={error ? true : undefined} {...props} />
      <FieldError errors={[error]} />
    </Field>
  );
}
