import {
  AsYouType,
  getCountryCallingCode,
  getExampleNumber,
  parsePhoneNumberFromString,
  type CountryCode,
} from 'libphonenumber-js';
import examples from 'libphonenumber-js/mobile/examples';
import metadata from 'libphonenumber-js/metadata.min.json';

export type { CountryCode };
export type Mode = 'identifier' | 'phone';
export type FieldState = {
  kind: 'empty' | 'email' | 'phone';
  display: string;
  value: string;
  country: CountryCode;
};
export type Edit = { text: string; caret: number; inputType?: string | undefined };

export const defaultCountry: CountryCode = 'UA';

const formatting = /[\s().-]/g;

export function isPhoneLike(text: string): boolean {
  return /^[+\d(]/.test(text) && /^\+?[\d\s().-]*$/.test(text);
}

export function emptyState(country: CountryCode): FieldState {
  return { kind: 'empty', display: '', value: '', country };
}

export function mainCountry(callingCode: string): CountryCode | undefined {
  return metadata.country_calling_codes[callingCode]?.[0] as CountryCode | undefined;
}

export function examplePhone(country: CountryCode): string {
  return getExampleNumber(country, examples)?.formatNational() ?? '';
}

export function storedPhone(e164: string): string {
  return parsePhoneNumberFromString(e164)?.formatInternational() ?? e164;
}

function phoneDigits(text: string): string {
  const digits = text.replace(/\D/g, '');
  return text.trimStart().startsWith('+') ? `+${digits}` : digits;
}

function countPhoneChars(text: string, end: number): number {
  return text.slice(0, end).replace(/[^\d+]/g, '').length;
}

function caretAfterPhoneChars(display: string, count: number): number {
  if (count === 0) return 0;
  let seen = 0;
  for (let index = 0; index < display.length; index += 1) {
    if (/[\d+]/.test(display[index] ?? '')) seen += 1;
    if (seen === count) return index + 1;
  }
  return display.length;
}

function formatPhone(raw: string, country: CountryCode, forceCountry = false): FieldState {
  const typer = new AsYouType(country);
  const display = typer.input(raw);
  const value = typer.getNumberValue() ?? raw;
  if (forceCountry || !raw.startsWith('+')) return { kind: 'phone', display, value, country };
  const callingCode = typer.getCallingCode();
  const keepCurrent = callingCode === getCountryCallingCode(country);
  const detected =
    typer.getCountry() ??
    (keepCurrent ? country : callingCode ? mainCountry(callingCode) : undefined);
  return { kind: 'phone', display, value, country: detected ?? country };
}

function deletedOnlyFormatting(prev: FieldState, edit: Edit): boolean {
  return (
    prev.kind === 'phone' &&
    edit.text.length < prev.display.length &&
    phoneDigits(edit.text) === phoneDigits(prev.display)
  );
}

function phoneEdit(prev: FieldState, edit: Edit): { state: FieldState; caret: number } {
  let raw = phoneDigits(edit.text);
  let count = countPhoneChars(edit.text, edit.caret);
  if (deletedOnlyFormatting(prev, edit)) {
    if (edit.inputType === 'deleteContentBackward' && count > 0) {
      raw = raw.slice(0, count - 1) + raw.slice(count);
      count -= 1;
    } else if (edit.inputType === 'deleteContentForward') {
      raw = raw.slice(0, count) + raw.slice(count + 1);
    }
  }
  if (raw === '') return { state: emptyState(prev.country), caret: 0 };
  const state = formatPhone(raw, prev.country);
  return { state, caret: caretAfterPhoneChars(state.display, count) };
}

function textEdit(prev: FieldState, edit: Edit): { state: FieldState; caret: number } {
  if (edit.text === '') return { state: emptyState(prev.country), caret: 0 };
  if (prev.kind !== 'phone') {
    return {
      state: { kind: 'email', display: edit.text, value: edit.text, country: prev.country },
      caret: edit.caret,
    };
  }
  const display = edit.text.replace(formatting, '');
  const caret = edit.text.slice(0, edit.caret).replace(formatting, '').length;
  return { state: { kind: 'email', display, value: display, country: prev.country }, caret };
}

export function applyEdit(
  prev: FieldState,
  edit: Edit,
  mode: Mode,
): { state: FieldState; caret: number } {
  if (mode === 'phone' || isPhoneLike(edit.text)) return phoneEdit(prev, edit);
  return textEdit(prev, edit);
}

export function stateFromValue(value: string, country: CountryCode, mode: Mode): FieldState {
  if (value === '') return emptyState(country);
  if (mode === 'phone' || isPhoneLike(value)) {
    const raw = phoneDigits(value);
    return raw === '' ? emptyState(country) : formatPhone(raw, country);
  }
  return { kind: 'email', display: value, value, country };
}

export function withCountry(prev: FieldState, country: CountryCode): FieldState {
  if (prev.kind !== 'phone') return { ...prev, country };
  const raw = phoneDigits(prev.display);
  if (!raw.startsWith('+')) return formatPhone(raw, country, true);
  const typer = new AsYouType(prev.country);
  typer.input(raw);
  const national = typer.getNationalNumber();
  return formatPhone(`+${getCountryCallingCode(country)}${national}`, country, true);
}
