import { MailIcon } from 'lucide-react';
import {
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type Ref,
} from 'react';
import type { FieldError as HookFormError } from 'react-hook-form';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { CountryPicker } from './CountryPicker';
import { IdentifierWords } from './IdentifierLabel';
import {
  applyEdit,
  defaultCountry,
  examplePhone,
  stateFromValue,
  withCountry,
  type CountryCode,
  type Mode,
} from './phoneText';

export type PhoneTextFieldProps = {
  mode: Mode;
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: (() => void) | undefined;
  ref?: Ref<HTMLInputElement> | undefined;
  error?: HookFormError | undefined;
  disabled?: boolean | undefined;
  autoComplete?: string | undefined;
  placeholder?: string | undefined;
};

function assignRef<T>(ref: Ref<T> | undefined, node: T | null) {
  if (typeof ref === 'function') ref(node);
  else if (ref) ref.current = node;
}

export function PhoneTextField({
  mode,
  label,
  name,
  value,
  onChange,
  onBlur,
  ref,
  error,
  disabled,
  autoComplete,
  placeholder,
}: PhoneTextFieldProps) {
  const id = useId();
  const input = useRef<HTMLInputElement | null>(null);
  const pendingCaret = useRef<number | null>(null);
  const [state, setState] = useState(() => stateFromValue(value, defaultCountry, mode));
  const [emitted, setEmitted] = useState(value);

  if (value !== emitted) {
    setEmitted(value);
    setState(stateFromValue(value, state.country, mode));
  }

  useLayoutEffect(() => {
    const caret = pendingCaret.current;
    pendingCaret.current = null;
    const node = input.current;
    if (caret !== null && node && node === document.activeElement) {
      node.setSelectionRange(caret, caret);
    }
  });

  const setInput = useCallback(
    (node: HTMLInputElement | null) => {
      input.current = node;
      assignRef(ref, node);
    },
    [ref],
  );

  function publish(next: typeof state, caret: number) {
    pendingCaret.current = caret;
    setState(next);
    setEmitted(next.value);
    onChange(next.value);
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const text = event.target.value;
    const inputType = (event.nativeEvent as Partial<InputEvent>).inputType;
    const edit = { text, caret: event.target.selectionStart ?? text.length, inputType };
    const result = applyEdit(state, edit, mode);
    publish(result.state, result.caret);
  }

  function handleCountry(country: CountryCode) {
    const next = withCountry(state, country);
    input.current?.focus();
    publish(next, next.display.length);
  }

  const showCountry = mode === 'phone' || state.kind === 'phone';

  return (
    <Field data-invalid={error ? true : undefined}>
      {mode === 'identifier' ? (
        <>
          <FieldLabel htmlFor={id} className="sr-only">
            {label}
          </FieldLabel>
          <FieldLabel htmlFor={id} aria-hidden="true">
            <IdentifierWords kind={state.kind} />
          </FieldLabel>
        </>
      ) : (
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
      )}
      <InputGroup data-disabled={disabled ? true : undefined}>
        <InputGroupInput
          id={id}
          ref={setInput}
          name={name}
          type={mode === 'phone' ? 'tel' : 'text'}
          inputMode={mode === 'phone' ? 'tel' : undefined}
          autoComplete={autoComplete ?? (mode === 'phone' ? 'tel' : 'username')}
          autoCapitalize="none"
          spellCheck={false}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          placeholder={placeholder ?? examplePhone(state.country)}
          value={state.display}
          onChange={handleChange}
          onBlur={onBlur}
        />
        {showCountry ? (
          <InputGroupAddon align="inline-start">
            <CountryPicker country={state.country} onChange={handleCountry} disabled={disabled} />
          </InputGroupAddon>
        ) : null}
        {state.kind === 'email' ? (
          <InputGroupAddon align="inline-start">
            <MailIcon aria-hidden />
          </InputGroupAddon>
        ) : null}
      </InputGroup>
      <FieldError errors={[error]} />
    </Field>
  );
}
