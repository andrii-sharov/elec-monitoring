# M14 — Mobile layout, phone formatting and webhook guide

**Goal:** every screen of the client is comfortable on a phone: controls
are large enough to tap, text is large enough to read, nothing overflows
the screen. Also: phone numbers format without the leading `0`, and
webhook users get a setup guide.

**Spec:** P §9 Client app · [theme.md](../theme.md) · P §7 Webhooks · A §8.

## Design

### Touch tier

The client has two sizes for controls and small text. The switch is a
custom Tailwind variant `compact`:

```css
@custom-variant compact (@media (width >= 48rem) and (pointer: fine));
```

- Below 768 px wide **or** on any touch-first device (phones in landscape,
  tablets), the touch tier applies. Laptops and desktops with a mouse keep
  today's compact look, unchanged.
- Base classes in `components/ui` are the touch size; `compact:` restores
  the desktop size. Pages never set control sizes (already enforced by
  `consistency.test.ts`), so the fix lives only in `components/ui`.

| Control                                | Touch               | Compact (today) |
| -------------------------------------- | ------------------- | --------------- |
| Button `default`, `lg`, Input, Select  | 44 px (`h-11`)      | 32 / 36 px      |
| Button `sm`, icon `sm`                 | 40 px (`h-10`)      | 28 px           |
| Button `xs`, icon `xs`                 | 36 px (`h-9`)       | 24 px           |
| Tab, Segment                           | 40 px               | 32 px           |
| Select, menu, picker and command items | 44 px rows          | 28 px rows      |
| Checkbox                               | 20 px, 44 px target | 16 px           |
| Switch                                 | 28 × 48 px          | 18 × 32 px      |

44 px follows the Apple HIG and WCAG 2.5.5 target size. Inputs and
searchable pickers use 16 px text in the touch tier, so iOS Safari
doesn't zoom the page on focus.

### Type scale

The touch tier raises the two smallest Tailwind steps through their
theme variables, so every `text-xs` and `text-sm` follows:

| Token       | Touch | Compact |
| ----------- | ----- | ------- |
| `text-xs`   | 13 px | 12 px   |
| `text-sm`   | 15 px | 14 px   |
| `text-base` | 16 px | 16 px   |

Arbitrary sizes below 12 px (`text-[0.65rem]`, `text-[0.8rem]`) are
replaced by `text-xs`.

### Layout on phones

- Dialogs and alert dialogs become bottom sheets below 640 px: full
  width, attached to the bottom, scrollable, padded for the home
  indicator. Footer buttons stay full width and within thumb reach.
- Popovers never exceed the screen width (`max-w-[calc(100vw-1rem)]`).
- Channel rows: checkbox, name block and switch sit in a three-column
  grid; the name block wraps tags and devices. Row actions become a
  two-column grid of full-width buttons.
- Delivery log rows stack event, status and time; Redeliver goes full
  width.
- The history period control scrolls sideways instead of wrapping into a
  second pill row; period arrows and the label span the width.
- Inputs and buttons that sit side by side (invite link + Copy, rename
  - Save) stack on phones.
- Auth pages keep the language switcher out of the brand row.
- History grid rows on phones grow from 20 px to 24 px (WCAG 2.5.8
  minimum).

### Phone formatting

`formatPhone` formatted a national number only when the user typed the
national prefix: `0671234567` became `067 123 4567`, but `671234567`
stayed one block. Numbers without `+` now try, in order:

1. Plain national formatting (unchanged when it formats).
2. The country's calling code typed without `+` (`38067…` →
   `380 67 …`), only when the digits keep that calling code.
3. The national prefix left out: format with the prefix, then drop it
   (`671234567` → `67 123 4567`). The prefix comes from the country's
   example number, so countries whose leading `0` belongs to the number
   (Italy) are untouched.

### Webhook guide

A page at `/notifications/webhooks/guide`, linked from the Notifications
page, the add-webhook form and the signing secret dialog (new tab there,
so the one-time secret stays on screen). Steps, in order:

1. Prepare a receiver: an `https` URL that accepts `POST` with JSON.
2. Add the webhook and choose events.
3. Save the signing secret. It's a key for checking requests, not a
   token to send. It's shown once; New secret replaces it.
4. Check every request: HMAC-SHA256 of the raw body with the secret,
   compared with `X-Elec-Signature` in constant time. Node.js and Python
   samples.
5. Answer `2xx` within 10 s, deduplicate by `X-Elec-Delivery`, and know
   the retry schedule and the 20-failure shutoff.
6. Send test: a `ping` event.

Headers and a sample `device.offline` body are shown as reference. The
page reuses A §8 values; it doesn't add API behaviour.

## Tasks

1. `compact` variant and touch type scale in `styles.css`; theme.md
   section "Touch tier".
2. Touch sizes in `components/ui`: button, input, input-group, select,
   dropdown-menu, command, checkbox, switch, tabs, segmented control,
   popover, dialog, alert-dialog. `PickerList` rows.
3. Remove page-level size overrides (`h-8` on the channel search) and
   tiny arbitrary text.
4. Phone layouts: channel row, delivery log, history controls and grid,
   members, auth layout, dialogs with side-by-side controls.
5. Phone formatting without the national prefix or `+` (tests first).
6. Webhook guide page, links, uk / en / ru strings, route test.
7. Spec: P §9 (touch tier, guide page), ROADMAP.

## Tests

- `phoneText.test.ts`: number without `0`, calling code without `+`
  while typing, foreign calling code stays national, France, Italy.
- `consistency.test.ts`: pages don't set control heights (`h-*` on
  `Input`, `Button`, `SelectTrigger`) or font sizes below `text-xs`.
- Webhook guide renders its steps and the signature sample; links from
  the Notifications page and the secret dialog point to it.
- Existing component tests keep passing (sizes don't change behaviour).

## Manual checks

Verify by hand on a real phone (iOS Safari and Android Chrome) and in
desktop browser device mode at 360 px, 390 px and 768 px, in light and
dark, in each app style:

- Sign up and log in: no zoom when focusing an input; the language
  switcher doesn't cover the brand.
- Every button, select, tab and checkbox is easy to hit with a thumb.
- Device page: period control scrolls sideways, grid cells open their
  popover, table rows read well.
- Notifications: channel row layout, actions grid, delivery log,
  add-webhook sheet, secret sheet, guide page with code samples that
  scroll sideways rather than overflow.
- Dialogs open as bottom sheets on a phone and centered on desktop.
- Desktop with a mouse at full width looks the same as before.
- Phone field with Ukraine: `671234567`, `0671234567`, `380671234567`
  and `+380671234567` all show a formatted number.
