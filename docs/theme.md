# Neon Grid

Client and admin app theme, from [`assets/BRAND.md`](../assets/BRAND.md).
Dark is the default; the user can pick dark, light or system in Account →
Appearance (saved in `localStorage['em.theme']`).

| Color token              | Light     | Dark      | Used for                                                      |
| ------------------------ | --------- | --------- | ------------------------------------------------------------- |
| `--background`           | `#F3F6F8` | `#0B1015` | Page                                                          |
| `--surface`              | `#FFFFFF` | `#151E27` | Cards, dialogs, menus, header                                 |
| `--foreground`           | `#0B1015` | `#E8F0F4` | Text                                                          |
| `--muted-foreground`     | `#4F6070` | `#93A4B0` | Secondary text, labels, timestamps                            |
| `--primary`              | `#4D7A00` | `#C8F560` | Main buttons, links, active nav (signal lime)                 |
| `--primary-foreground`   | `#FFFFFF` | `#0B1015` | Text on primary                                               |
| `--secondary`            | `#EAEFF2` | `#1D2833` | Raised elements: hover, inputs (dark), chips                  |
| `--secondary-foreground` | `#0B1015` | `#E8F0F4` | Text on secondary                                             |
| `--border`               | `#D3DCE2` | `#2A3742` | Hairlines, dividers, card edges                               |
| `--input`                | `#7D8D99` | `#5C6E7E` | Form control borders (≥ 3:1 on surface)                       |
| `--ring`                 | `#4D7A00` | `#C8F560` | Focus ring                                                    |
| `--live`                 | `#00757E` | `#5CE1E6` | "Now" dot, check-in ping, network cause, active and sent tags |
| `--signal`               | `#C8F560` | `#C8F560` | Lime fill of the power card (both themes)                     |
| `--signal-foreground`    | `#0B1015` | `#0B1015` | Text on `--signal`                                            |
| `--status-online`        | `#4D7A00` | `#C8F560` | `ONLINE`, power on                                            |
| `--status-offline`       | `#C62828` | `#FF7A7A` | `OFFLINE`, open outage                                        |
| `--status-pending`       | `#5E6E7C` | `#8FA3B8` | `PENDING`, `UPDATING`, unknown cause                          |
| `--danger`               | `#C62828` | `#FF7A7A` | Destructive actions, errors                                   |
| `--danger-foreground`    | `#FFFFFF` | `#0B1015` | Text on danger                                                |
| `--warning`              | `#8A5A00` | `#FFC857` | Power blips, settings not yet applied                         |

BRAND's surface-2 is `--secondary` here, and BRAND's cyan `--accent` is
`--live`, because shadcn uses `--accent` for hover fills. Lime means power
on or the main action; nothing decorative is lime.

## shadcn/ui mapping

`card`, `popover` → `surface` (foreground → `foreground`) · `muted`, `accent`
→ `secondary` · `muted-foreground` → `muted-foreground` · `destructive` →
`danger` · `input`, `ring`, `border` as above.

## Contrast

Every text token is at least 4.5:1 on `--background` and `--surface` in both
modes. Light `--live` is darkened from BRAND's `#00808A` to `#00757E` for
that. Lime and cyan text stays off light `--secondary` (light `--primary`
is 4.4:1 there). Text on the `--signal` card uses `--signal-foreground`,
at least 75% opacity.

## Look

| Token                   | Value                                   | Purpose                            |
| ----------------------- | --------------------------------------- | ---------------------------------- |
| `--app-font-body`       | Inter Variable, system UI               | Body, buttons, forms (`font-sans`) |
| `--app-font-heading`    | JetBrains Mono Variable, `ui-monospace` | Titles, durations (`font-heading`) |
| `--app-font-mono`       | same as heading                         | Labels, times, IDs (`font-mono`)   |
| `--radius`              | `0.625rem`                              | Buttons and inputs; cards 14 px    |
| `--app-surface-ring`    | `var(--border)`                         | Card edge                          |
| `--app-surface-shadow`  | none (dark), `0 1px 2px` at 6 % (light) | Card shadow                        |
| `--app-motion-duration` | `180ms`                                 | Transitions and animations         |
| `--app-motion-ease`     | `cubic-bezier(0.22, 1, 0.36, 1)`        | Easing                             |

Both fonts come from `@fontsource-variable` with Cyrillic and are bundled.

### Rules

- Colors come only from the theme tokens above. Extra shades come from
  `color-mix()` or Tailwind opacity on a token, never hex. Light and dark
  both work.
- Status is a word plus a shape, never color alone: `StatusMark` (in
  `client/src/components/device/`) shows a filled dot for `ONLINE`, a
  hollow ring for `OFFLINE` and a dashed ring for `PENDING` / `UPDATING`,
  next to the translated state.
- The power card (`PowerCard`) is the device hero: `ONLINE` is a
  `--signal` card with dark text, "● POWER ON" and a big mono duration;
  `OFFLINE` is a surface card with a 2 px `--status-offline` inset ring;
  `PENDING` / `UPDATING` have a dashed `--input` border.
- The 7-day power strip is a square wave: high `--status-online` line for
  power on, low `--status-offline` line for outages, `--warning` ticks for
  blips, a dashed `--status-pending` line for no data.
- Motion follows an action or a real state change from a poll. The
  exceptions: the live dot next to an open outage in the timeline, the
  looping promo video on auth pages and the promo animation on the landing
  page, and the entrance (`data-motion="enter"`, staggered by `--i`) of
  lists, the device hero, history rows, channel rows, member rows and the
  landing hero. The delivery log is a tab panel inside its channel card,
  so its rows have no entrance of their own: the panel fades and the
  card's entrance is the only one.
  The tab indicator slides with the motion tokens, and so does the
  `SegmentedControl` indicator.
- Base controls look and move the same on every page. All dropdown
  popups (`Select`, `PickerField`, `CountryPicker`) share one padded popup
  with the same open and close animation. Segmented groups share the pill
  tab look. Pages never restyle a control from `components/ui`;
  `components/ui/consistency.test.ts` enforces this.
- Entrance lasts `--app-enter-duration` (`min(2 × --app-motion-duration,
  240ms)`), starts at 40% opacity, and its stagger is
  `min(--i, 8) × 30ms`. Tab and view panels only fade
  (`data-motion="panel"`, `--app-panel-duration`, at most 120 ms).
  Entrances are never nested.
- Change motion plays only while `useStateChange` reports a real change,
  never on mount: a hard two-step fade on the status mark and power card
  when the state flips, and a single `--live` ping around the status dot
  when a new check-in arrives. `client/src/motion.test.tsx` checks
  `styles.css` and the first render of `StatusMark`.
  `prefers-reduced-motion: reduce` sets the motion tokens to `0ms`, turns
  off animation on every `[data-motion]` element and the ping, and stops
  the promo video (poster with controls).
- Illustrations (`assets/illustrations/`, `Illustration` and `EmptyState`
  in the client) are inlined, so their `var(--primary, …)` style fills
  follow the theme tokens and the light/dark toggle. They are decorative
  (`aria-hidden`); the text next to them carries the meaning.
- The brand mark (`BrandMark`, `assets/logo/`) keeps its fixed colors
  (dark tile, lime wave, cyan dot) in both themes; it is the only hex in
  components. The header wordmark is live text in JetBrains Mono: the
  first word in the foreground, the rest in `--primary`, then a `--live`
  underscore.
- The history grid fills each hour by the share without power with
  `--status-offline`, on a `--status-online` tint; blips are a `--warning`
  dot; the current hour has a `--live` ring. Every cell has a text label.
- Stats charts use the same colors: time without power is
  `--status-offline`, power blips `--warning`, causes are power
  `--status-offline`, network `--live` and unknown `--status-pending`.
  The availability meter fills `--status-online` over `--status-offline`.
  Axis text is `--muted-foreground`, grid lines `--border`. Charts never
  animate their bars; the cards enter with `data-motion="enter"`. Each
  chart is `aria-hidden` next to a screen-reader table with its values.

## Touch tier

Controls and small text have two sizes. The `compact` Tailwind variant
(`styles.css`) is true at 768 px and wider **with** a fine pointer
(mouse, trackpad). Everywhere else (phones, tablets, phones in
landscape) the touch tier applies. Base classes in `components/ui` are
the touch size, and `compact:` restores the desktop size.

| Control                                 | Touch      | Compact    |
| --------------------------------------- | ---------- | ---------- |
| Button `default`, Input, Select trigger | 44 px      | 32 px      |
| Button `lg`                             | 48 px      | 36 px      |
| Button `sm`, `icon-sm`, pill tab        | 40 px      | 28–32 px   |
| Button `xs`, `icon-xs`                  | 36 px      | 24 px      |
| Select, menu, picker, command rows      | 44 px      | 28 px      |
| Checkbox                                | 20 px      | 16 px      |
| Switch                                  | 28 × 48 px | 18 × 32 px |
| `text-xs` / `text-sm`                   | 13 / 15 px | 12 / 14 px |

- Inputs and search fields use 16 px text in the touch tier, so iOS
  Safari doesn't zoom on focus.
- Below 640 px, dialogs and alert dialogs are bottom sheets: full width,
  attached to the bottom, scrollable, padded for the home indicator.
- Popovers are never wider than the screen. Fields side by side in a
  popover stack below 640 px.
- Native date and time inputs drop the native look on touch devices
  (`styles.css`), so iOS Safari lets them shrink to their column.
- Charts and grids pick a phone form instead of shrinking: the history
  grid shows hours by day for up to 7 days on a phone (31 on wider
  screens) and a calendar of days beyond that. The stats chart hides
  its duration axis on a phone and labels every 3rd hour or every 2nd or
  5th day; it never scrolls sideways (at most 31 bars). Stat tiles sit two
  per row on a phone.
- Segmented controls fill one row on phones and scroll sideways only
  when they can't fit. Line tabs share the width equally, icon above a
  wrapping label.
- Pages never set control heights or text smaller than `text-xs`;
  `components/ui/consistency.test.ts` enforces both.
