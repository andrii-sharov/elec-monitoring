# M7a — Phone input with country picker

Follow-up polish to [M7](M07-phone-auth.md), done before M8.

## Design

### Intent

Phone entry should feel like a modern website: a country picker with a flag
and dialing code, and live formatting while typing. Fields that accept an
email or a phone should recognise a phone number on their own, so the
sign-up Email/Phone toggle goes away and every such field behaves the same.

### Goals

- **Smart identifier field** (sign up, log in, forgot password, device
  sharing). It starts plain. When the value starts with a digit or `+` and
  holds only phone characters (digits, spaces, `()`, `-`, `+`), a country chip
  (flag + `+380`) appears on the left and the number formats as typed. Any
  other character (letters, `@`) switches back to email mode and the chip
  hides.
- **Phone field** (Account → Add phone). The chip is always shown.
- **Country chip.** Opens a searchable list of all countries (name in the UI
  language or dialing code). Defaults to Ukraine, matching the
  server's default. Typing `+48…` switches the chip to Poland automatically.
- **Sign-up** loses the Email/Phone toggle and uses the smart field. The
  `?email=` / `?phone=` prefill from invites keeps working.
- The client sends phones as E.164, built from the selected country. The
  client validates the number with the same rules before submitting.

### Non-goals

- No API, database or server validation changes. `phoneSchema` already
  accepts E.164.
- No SMS, no other identifier types.
- The Add email form stays a plain email field.

### Anti-goals

- The cursor must not jump when editing in the middle of a formatted number,
  deleting a space, or pasting.
- No mismatch with the server: a number the client accepts must be accepted
  by `normalizePhone`.
- Don't put every country's flag SVG into the main bundle.

### Constraints

- Use `libphonenumber-js` (already in `shared/`): `AsYouType` for formatting,
  `getCountries` / `getCountryCallingCode` for the list.
- Country names come from `Intl.DisplayNames` in the current language (uk, en,
  ru).
- Flags are SVGs from `country-flag-icons`, so they look the same on Windows,
  where emoji flags show as letters.
- The country list reuses the existing `PickerField` (cmdk search), like
  `TimezoneSelect`.
- Visuals use existing theme tokens. No new colours.

### Approaches

1. **Own component on `libphonenumber-js` (chosen).** No new phone library.
   Matches the shadcn/Base UI look. Easy to switch between email and phone
   in one field because we control the whole thing. Cost: we handle cursor
   positioning ourselves, so it needs tests.
2. `react-phone-number-input`: ready-made, but no email/phone switching, so
   we'd wrap it and fight its styles.
3. `react-international-phone`: nicer defaults, same email/phone gap, and its
   own phone data could disagree with what the server accepts.

### Left to the builder

- Component split (a shared phone core used by `IdentifierField` and a
  `PhoneField`), the detection helper, and the cursor-restoring approach.
- How flags are loaded so the main bundle stays small (e.g. lazy chunk or
  per-flag imports).
- New translation keys in all three locales (e.g. "Email or phone", country
  search label, empty state).
- Whether to show stored phones (account row, members list) in
  international format. Small and nice to have; builder's call.
- Update PROJECT_V2 client text if it describes the sign-up toggle.

### Calls made in the build

- Stored phones (account row, members, pending invites, invite toast) show
  in international format, e.g. `+380 50 123 4567`.
- A value is a phone when it starts with a digit, `+` or `(` and holds only
  digits, spaces, `()`, `.`, `-` and a leading `+`. Anything else is an
  email. The shared `isEmailInput` (`@` check) is removed.
- The client rejects an invalid number with "Enter a valid phone number"
  before sending, using the shared `normalizePhone`.
- Flags load as one lazy chunk (`country-flag-icons/string/3x2`, about 50 kB
  gzipped) the first time a country chip renders.

## Build

- `client/src/forms/phone/phoneText.ts`: detection, formatting, E.164 value,
  cursor position and country switching as pure functions (unit tested).
- `client/src/forms/phone/PhoneTextField.tsx`: the field in `identifier` or
  `phone` mode; `ControlledPhoneField` binds it to react-hook-form.
- `client/src/forms/phone/CountryPicker.tsx`, `countries.ts`, `Flag.tsx`:
  the chip and searchable list (country name or `+code`).
- `client/src/components/PickerList.tsx`: the search list extracted from
  `PickerField` and shared with the country picker.
- Pages: sign up (switch removed), log in, forgot password, device sharing,
  Account → Add phone.

## Manual checks (staging)

1. Log in: type `0501234567`; the 🇺🇦 +380 chip appears and the field shows
   `050 123 4567`. Type a letter; the chip disappears and a mail icon shows.
2. Type `+48 512 345 678`; the chip switches to Poland.
3. Edit a digit in the middle and press Backspace right after a space; the
   cursor stays in place and the digit before the space is removed.
4. Paste `+38 (050) 123-45-67`; it reads as one Ukrainian number.
5. Open the chip, search `pol` and `+48`, pick Poland; the number re-reads
   in Poland and focus returns to the field.
6. Sign up with a phone and with an email from the same field.
7. Account → Add phone shows the chip from the start.
8. Flags look right on Windows (not letters) and in dark theme.
9. On a phone, the country list fits the screen and scrolls.
