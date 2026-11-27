# Electricity Monitor: brand and visual style ("Neon Grid")

A brief for designing the app UI. All brand assets in this folder already follow it.

## 1. Idea and personality

The product watches the mains around the clock and reports the moment power goes
out or comes back. The style borrows from the tools engineers trust for
monitoring: terminals, oscilloscopes, Grafana panels.

- **Dark first.** People open the app during a blackout, often at night, on a phone
  on battery. Dark is the main theme. Light is a full, supported variant.
- **Signal, not decoration.** The only bright colours are status colours. If
  something glows lime, power is ON. Nothing else should be lime.
- **Calm and precise.** Flat surfaces, hairline borders, monospace numbers, no
  gradients or drop shadows. The faint grid and soft glow are for marketing
  surfaces only (OG images, hero, Telegram banner), never behind app content.
- **A little nerdy.** Lowercase-friendly, terminal touches like the `_` cursor
  and `>` prompt. Use them sparingly: a touch in the brand, never in body copy.

## 2. Logo

**Mark:** a dark rounded tile with a lime **square wave** that steps between
OFF (low) and ON (high), ending in a cyan **live dot**. It reads as "power
signal, currently online".

| File                                            | Use                                                                      |
| ----------------------------------------------- | ------------------------------------------------------------------------ |
| `logo/logo-mark.svg`                            | App icon, avatar, anywhere ≥ 32 px                                       |
| `favicon/favicon.svg`                           | 16–32 px. A simpler one-step wave with thicker lines                     |
| `logo/logo-mark-mono.svg`                       | One colour (`currentColor`), e.g. a header icon tinted by text colour    |
| `logo/logo-animated.svg`                        | Splash or loading. A highlight runs along the wave, then the dot pings   |
| `logo/logo-{en,uk,ru}.svg`                      | Mark + wordmark. Follows the system light/dark setting                   |
| `logo/logo-{lang}-light.svg` / `-dark.svg`      | Fixed versions for light or dark backgrounds                             |

**Wordmark:** JetBrains Mono Bold. The first word is in the foreground colour,
the second in signal lime (olive `#4D7A00` on light), followed by a cyan
underscore cursor. Localised: "Electricity Monitor", "Монітор електрики",
"Монитор электричества". Text is converted to paths, so no font is needed to
display it.

**Rules**

- The mark keeps its fixed colours (dark tile, lime wave, cyan dot) on both light
  and dark backgrounds. Don't recolour it. Use the mono version when you need one colour.
- Clear space around the mark: at least ¼ of its width. Minimum size: 16 px
  (favicon version), 24 px (full mark), 120 px wide (lockup).
- Don't add gradients, shadows or outlines. Don't rotate the wave or put
  the cursor anywhere except after the wordmark.

## 3. Colour

Token names match the app's existing tokens (`--primary`, `--status-online`, …),
so the new values drop straight into `docs/theme.md`. The illustrations already read these tokens.

### Dark (main theme)

| Token                       | Hex       | Role                                                                     |
| --------------------------- | --------- | ------------------------------------------------------------------------ |
| `--background`              | `#0B1015` | App background ("ground")                                                |
| `--surface`                 | `#151E27` | Cards, sheets, nav bars. Also the logo tile                              |
| `--card` / surface-2        | `#1D2833` | Raised elements on a surface: list rows on hover, inputs, chips          |
| `--border`                  | `#2A3742` | Hairlines, dividers, input borders                                       |
| `--foreground`              | `#E8F0F4` | Main text (16.6:1 on ground)                                             |
| `--muted-foreground`        | `#93A4B0` | Secondary text, labels, timestamps (6.6:1 on surface)                    |
| `--primary`                 | `#C8F560` | **Signal lime.** Primary buttons, active states, focus rings, links      |
| `--primary-foreground`      | `#0B1015` | Text on lime (15.2:1)                                                    |
| `--accent`                  | `#5CE1E6` | **Live cyan.** The "now" dot, live indicators, info highlights. Use rarely |
| `--status-online`           | `#C8F560` | Power ON                                                                 |
| `--status-offline`          | `#FF7A7A` | Power OFF / outage, destructive actions (6.7:1 on surface)               |
| `--status-pending`          | `#8FA3B8` | Waiting for the device to check in, unknown                              |
| `--warning`                 | `#FFC857` | Warnings, weak signal, "lamp light" in illustrations                     |

### Light

| Token                  | Hex       | Note                                               |
| ---------------------- | --------- | -------------------------------------------------- |
| `--background`         | `#F3F6F8` |                                                    |
| `--surface`            | `#FFFFFF` |                                                    |
| `--card`               | `#EAEFF2` |                                                    |
| `--border`             | `#D3DCE2` |                                                    |
| `--foreground`         | `#0B1015` |                                                    |
| `--muted-foreground`   | `#4F6070` | 6.0:1 on background                                |
| `--primary`            | `#4D7A00` | Olive: lime is unreadable as text on white (5.1:1) |
| `--primary-foreground` | `#FFFFFF` |                                                    |
| `--accent`             | `#00808A` | Text-safe cyan (4.7:1)                             |
| `--status-online`      | `#4D7A00` |                                                    |
| `--status-offline`     | `#C62828` |                                                    |
| `--status-pending`     | `#5E6E7C` |                                                    |
| `--warning`            | `#8A5A00` |                                                    |

On light, a **lime-filled** element (badge, big status card) is still fine with
`#0B1015` text on `#C8F560`. Only lime as **text or thin lines** on white must
switch to olive.

**Proportions:** about 90% ground/surface/text, 8% muted and borders, 2% signal
colours. Lime always means something.

**Status is never colour alone.** Pair it with a word and a shape: filled dot ●
plus "ON", hollow ring ○ plus "OFF". Online lime and offline coral also differ
in lightness, so they stay distinguishable for colour-blind users.

## 4. Typography

| Role                                                  | Font                | Weight   | Notes                                                    |
| ----------------------------------------------------- | ------------------- | -------- | -------------------------------------------------------- |
| Wordmark, screen titles, big numbers (durations, times, voltages) | **JetBrains Mono** | 700 / 800 | Tabular by nature, so timers don't jitter              |
| Small labels, chips, code, IDs, timestamps            | JetBrains Mono      | 500      | Uppercase + 0.05em tracking for tiny section labels       |
| Body text, buttons, forms, long messages              | **Inter**           | 400 / 500 / 600 | Mono is too wide for paragraphs, especially Cyrillic |

Both are free (Google Fonts / Fontsource) and include Cyrillic (uk, ru).
Fallbacks: `ui-monospace, Menlo, Consolas, monospace` and `system-ui, sans-serif`.

Scale (px): 12 · 14 · 16 (body) · 20 · 24 · 32 · 44 (hero numbers). Line height
1.5 for body, 1.15 for headings and numbers.

## 5. Shape, space, depth

- **Radii:** 14 px cards and tiles (the logo tile is 14/64), 10 px buttons and
  inputs, 999 px chips and status pills.
- **Spacing:** 4 px base grid. Common steps 8 / 12 / 16 / 24 / 32 / 44.
- **Borders over shadows.** Surfaces separate by colour step plus a 1 px
  `--border`. No drop shadows in dark mode. In light mode at most a very soft
  shadow (0 1 2 rgba(11,16,21,.06)).
- **No gradients** in UI. The radial cyan glow and the 40 px grid belong to
  marketing images only.
- Touch targets ≥ 44 px.

## 6. Icons and illustrations

- Line icons, 2 px stroke at 24 px, round caps and joins (e.g. Lucide). Colour
  `currentColor`, usually `--muted-foreground`; lime only for an active or ON state.
- The square wave is the house motif: use it for dividers in empty states, chart
  "on/off" timelines, loading bars. Draw it with right angles, never a smooth sine.
- Empty-state illustrations (`illustrations/`) are flat line art in theme
  tokens, 3 px strokes. New ones should match.

## 7. Motion

- Motion explains state, never decorates. Typical: a highlight running along the
  wave while connecting, the live dot "pinging" when a check-in arrives, a status card
  sliding in when power changes.
- Timing 150–250 ms, ease-out. State flips (ON ↔ OFF) can use a hard `steps(1)`
  cut to feel like a signal edge.
- Respect `prefers-reduced-motion`: show the final state, no loops. All the SVG
  assets already do this.

## 8. Key components (reference)

- **Power status card:** the hero element of the app. ON = lime-filled card,
  dark text, "● POWER ON", big mono duration ("3 h 42 min"), muted "since 14:20 ·
  Home". OFF = surface card with a 2 px coral inset border, "○ POWER OFF", coral
  label.
- **Primary button:** lime fill, `#0B1015` text, Inter 600, 10 px radius.
  Secondary: transparent, 1.5 px `--muted-foreground` outline. Destructive: coral.
- **Notification row / Telegram preview:** surface card with the mark at 36 px,
  bold title, body in foreground, time in muted mono.
- **History timeline:** square-wave track. High segments lime (ON), low segments
  coral (OFF), pending dashed slate.

A visual of these four directions, with this one as `01 Neon Grid`, is on the
design canvas: https://claude.ai/artifact/Cho7wtzfnP7863LcV57Q5m

## 9. Copy tone

Short, factual, calm. "Power is back at Home. Outage lasted 2 h 13 min." The
`>` prompt and `_` cursor are brand garnish for marketing headers only.
