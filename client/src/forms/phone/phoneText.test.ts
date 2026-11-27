import { describe, expect, test } from 'vitest';
import {
  applyEdit,
  emptyState,
  examplePhone,
  isPhoneLike,
  stateFromValue,
  storedPhone,
  withCountry,
  type FieldState,
  type Mode,
} from './phoneText';

function typeText(text: string, mode: Mode = 'identifier', start = emptyState('UA')): FieldState {
  let state = start;
  for (const char of text) {
    const next = state.display + char;
    state = applyEdit(state, { text: next, caret: next.length }, mode).state;
  }
  return state;
}

describe('isPhoneLike', () => {
  test.each(['0', '+', '+380', '050 123 45 67', '(050) 123-45-67', '+38 (050) 123.45.67'])(
    '%s is a phone',
    (text) => {
      expect(isPhoneLike(text)).toBe(true);
    },
  );

  test.each(['', ' ', 'j', '123j', 'john@example.com', '050@x', '-1'])('%s is not', (text) => {
    expect(isPhoneLike(text)).toBe(false);
  });
});

describe('typing in the identifier field', () => {
  test('a Ukrainian number formats as typed and stores E.164', () => {
    expect(typeText('0501234567')).toEqual({
      kind: 'phone',
      display: '050 123 4567',
      value: '+380501234567',
      country: 'UA',
    });
  });

  test('a foreign number switches the country', () => {
    expect(typeText('+48512345678')).toMatchObject({
      display: '+48 512 345 678',
      value: '+48512345678',
      country: 'PL',
    });
  });

  test('+1 picks the main country before the area code', () => {
    expect(typeText('+1')).toMatchObject({ country: 'US' });
  });

  test('a number with 380 but no plus still stores E.164', () => {
    expect(typeText('380501234567').value).toBe('+380501234567');
  });

  test('a Ukrainian number without the leading 0 formats as typed', () => {
    expect(typeText('50123')).toMatchObject({ display: '50 123', country: 'UA' });
    expect(typeText('501234567')).toEqual({
      kind: 'phone',
      display: '50 123 4567',
      value: '+380501234567',
      country: 'UA',
    });
  });

  test('a number with 380 but no plus formats while typed', () => {
    expect(typeText('380501')).toMatchObject({ display: '380 50 1', value: '+380501' });
    expect(typeText('380501234567')).toMatchObject({ display: '380 50 123 4567' });
  });

  test('a calling code of another country without a plus stays national', () => {
    expect(typeText('382123456', 'phone').value).toBe('+380382123456');
  });

  test('other countries format without their national prefix too', () => {
    const state = typeText('612345678', 'phone', emptyState('FR'));
    expect(state).toMatchObject({ display: '6 12 34 56 78', value: '+33612345678' });
  });

  test('a country whose leading 0 is part of the number keeps its own format', () => {
    const state = typeText('3123456789', 'phone', emptyState('IT'));
    expect(state).toMatchObject({ display: '312 345 6789', value: '+393123456789' });
  });

  test('an email stays as typed', () => {
    expect(typeText('john@example.com')).toEqual({
      kind: 'email',
      display: 'john@example.com',
      value: 'john@example.com',
      country: 'UA',
    });
  });

  test('an email starting with digits drops the phone spacing', () => {
    expect(typeText('0501234567j@x.ua')).toMatchObject({
      kind: 'email',
      display: '0501234567j@x.ua',
    });
  });

  test('clearing the field returns to empty', () => {
    const state = applyEdit(typeText('05'), { text: '', caret: 0 }, 'identifier').state;
    expect(state).toEqual(emptyState('UA'));
  });

  test('a pasted formatted number is read whole', () => {
    const pasted = '+38 (050) 123-45-67';
    const { state } = applyEdit(
      emptyState('UA'),
      { text: pasted, caret: pasted.length },
      'identifier',
    );
    expect(state).toMatchObject({ display: '+380 50 123 4567', value: '+380501234567' });
  });
});

describe('caret', () => {
  test('stays after the edited digit when typing in the middle', () => {
    const start = typeText('050 123 4567');
    const text = '0509 123 4567';
    const { state, caret } = applyEdit(start, { text, caret: 4 }, 'identifier');
    expect(state.display.slice(0, caret).replace(/\D/g, '')).toBe('0509');
  });

  test('backspace over a space deletes the digit before it', () => {
    const start = typeText('0501234567');
    expect(start.display).toBe('050 123 4567');
    const { state, caret } = applyEdit(
      start,
      { text: '050123 4567', caret: 3, inputType: 'deleteContentBackward' },
      'identifier',
    );
    expect(state.value).toBe('+38051234567');
    expect(state.display.slice(0, caret).replace(/\D/g, '')).toBe('05');
  });

  test('delete over a space removes the digit after it', () => {
    const start = typeText('0501234567');
    const { state } = applyEdit(
      start,
      { text: '050123 4567', caret: 3, inputType: 'deleteContentForward' },
      'identifier',
    );
    expect(state.display.replace(/\D/g, '')).toBe('050234567');
  });
});

describe('phone mode', () => {
  test('letters are ignored', () => {
    expect(typeText('05a0', 'phone')).toMatchObject({ kind: 'phone', display: '050' });
  });
});

describe('withCountry', () => {
  test('reads a national number in the chosen country', () => {
    const state = withCountry(typeText('512345678'), 'PL');
    expect(state).toMatchObject({ value: '+48512345678', country: 'PL' });
  });

  test('swaps the calling code of an international number', () => {
    const state = withCountry(typeText('+380512345678'), 'PL');
    expect(state).toMatchObject({
      display: '+48 512 345 678',
      value: '+48512345678',
      country: 'PL',
    });
  });

  test('keeps a picked country that shares the calling code', () => {
    const state = withCountry(typeText('+1 613'), 'CA');
    expect(typeText('5', 'identifier', state).country).toBe('CA');
  });

  test('only changes the country of an email', () => {
    expect(withCountry(typeText('j@x.ua'), 'PL')).toMatchObject({
      display: 'j@x.ua',
      country: 'PL',
    });
  });
});

describe('stateFromValue', () => {
  test('formats a stored phone', () => {
    expect(stateFromValue('+380501234567', 'UA', 'identifier')).toMatchObject({
      kind: 'phone',
      display: '+380 50 123 4567',
      value: '+380501234567',
    });
  });

  test('keeps an email', () => {
    expect(stateFromValue('mary@example.com', 'UA', 'identifier')).toMatchObject({
      kind: 'email',
      display: 'mary@example.com',
    });
  });
});

test('examplePhone gives a national sample for the country', () => {
  expect(examplePhone('UA')).toBe('050 123 4567');
  expect(examplePhone('PL')).toBe('512 345 678');
});

test('storedPhone shows E.164 in international format', () => {
  expect(storedPhone('+380501234567')).toBe('+380 50 123 4567');
  expect(storedPhone('nonsense')).toBe('nonsense');
});
