# M16 — Neon Grid redesign

**Goal:** the client takes the Neon Grid brand from `assets/BRAND.md`: one
look instead of four app styles, dark by default, Inter and JetBrains Mono,
the square-wave mark, a lime power status card and a square-wave 7-day
timeline. A public landing page introduces the product to signed-out
visitors.

**Spec:** [PROJECT_V2.md](../PROJECT_V2.md) §9 · [theme.md](../theme.md) ·
[`assets/BRAND.md`](../../assets/BRAND.md) · [`assets/README.md`](../../assets/README.md).

## Global constraints

- Colours come only from theme tokens. The brand mark keeps its fixed
  colours and is the only hex in components.
- Motion system stays: `data-motion="enter"` / `"panel"`, motion tokens,
  `useStateChange` for change motion, `prefers-reduced-motion` respected.
- Controls come only from `components/ui` (`consistency.test.ts`).
- Every new text gets a key in `uk`, `en` and `ru` (`parity.test.ts`).
- No real timers in tests. Run the full `npm test` from the repo root.
- The user commits.

## Design decisions

1. **One look.** Classic, Sonar, Switchboard and Lamp are removed with
   the style picker, the welcome page (`/welcome/appearance`) and
   `localStorage['em.appStyle']`. The slot components become plain
   components in `client/src/components/device/`: `StatusMark`,
   `DeviceCard`, `PowerCard` (device hero). Old `/welcome/appearance`
   links redirect to `/devices`.
2. **Palette.** `theme.md` takes the Neon Grid tokens. BRAND's surface-2
   (`#1D2833` / `#EAEFF2`) is the app's `--secondary`; BRAND's cyan
   `--accent` is the app's `--live`, because shadcn already uses
   `--accent` for hover fills. `--input` and `--ring` are added to keep
   control borders at 3:1 and focus rings visible.
3. **Dark by default.** A browser with no saved theme starts dark. System
   and Light stay in Account → Appearance.
4. **Type.** Inter (body, buttons, forms) and JetBrains Mono (screen
   titles, durations, times, labels, IDs) from `@fontsource-variable`,
   Cyrillic included, bundled with the app.
5. **Status.** Status is a word plus a shape: filled dot ● for ON, hollow
   ring ○ for OFF, dashed ring for pending/updating. The live cyan dot
   pings once when a new check-in arrives (`useStateChange` on
   `last_seen_at`), never on mount.
6. **Power card.** ON: lime-filled card, dark text, "● POWER ON", big mono
   duration, muted "since 14:20 · Home". OFF: surface card with a 2 px
   coral inset border and coral "○ NO CONTACT" label. Pending / updating:
   surface card with a dashed border. The 7-day strip below is a square
   wave: high lime for power on, low coral for outages, warning ticks for
   blips, dashed slate for no data.
7. **Charts.** Network as a cause uses `--live` (cyan), so lime only ever
   means power on.
8. **Landing page.** A public `/` for signed-out visitors (signed-in users
   still go to `/devices`): hero with the promo SVG, how it works, history,
   alerts and sharing, and a closing call to sign up. Built
   in the client's React stack with the same tokens and controls.

## Tasks

- [x] T1 Tokens, fonts, dark default, header, auth layout, brand mark
- [x] T2 Remove app styles; `StatusMark`, `DeviceCard`, `PowerCard`
- [x] T3 Square-wave power strip, chart colours
- [x] T4 Landing page
- [x] T5 Docs: theme.md, PROJECT_V2 §9, ROADMAP

## Verify by hand after all tasks

- Dark and light themes on Devices, Device (ON, OFF, pending), History,
  Stats, Notifications, Account, auth pages and the landing page.
- The live dot pings once when a check-in arrives and stays still on load.
- The 7-day square wave matches the History tab for the same week.
- Reduced motion: nothing animates, nothing stays hidden.
- Phone: bottom tab bar, power card and landing page at 390 px and 320 px.
- Cyrillic text in Inter and JetBrains Mono (uk, ru).
