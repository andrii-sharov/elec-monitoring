# Underwater Dream

Client and admin app theme. It follows `prefers-color-scheme` by default;
the user can pick light, dark or system in Account → Appearance (saved in
`localStorage['em.theme']`).

| Color token              | Light     | Dark      | Used for                                |
| ------------------------ | --------- | --------- | --------------------------------------- |
| `--background`           | `#DBE9EE` | `#101D24` | Page                                    |
| `--surface`              | `#FFFFFF` | `#192C36` | Cards, dialogs, menus, inputs           |
| `--foreground`           | `#203844` | `#E6F1F5` | Text                                    |
| `--muted-foreground`     | `#476471` | `#B2C8D1` | Secondary text                          |
| `--primary`              | `#166088` | `#92CBE6` | Main buttons, links                     |
| `--primary-foreground`   | `#FFFFFF` | `#102530` | Text on primary                         |
| `--secondary`            | `#C0D6DF` | `#2A414D` | Secondary buttons, hover, muted areas   |
| `--secondary-foreground` | `#294652` | `#DBE9EE` | Text on secondary                       |
| `--border`               | `#B6CBD4` | `#405965` | Dividers, card edges                    |
| `--input`                | `#738E9B` | `#64808D` | Form control borders (≥ 3:1 on surface) |
| `--ring`                 | `#166088` | `#AADAF0` | Focus ring                              |
| `--status-online`        | `#146847` | `#79DEB2` | `ONLINE`, recovery                      |
| `--status-offline`       | `#A43042` | `#FFA0AC` | `OFFLINE`, open outage                  |
| `--status-pending`       | `#56657A` | `#A5B4CA` | `PENDING`, `UPDATING`, unknown cause    |
| `--danger`               | `#A43042` | `#FFA0AC` | Destructive actions, errors             |
| `--danger-foreground`    | `#FFFFFF` | `#102530` | Text on danger                          |
| `--warning`              | `#855A12` | `#F1C677` | Power blips, settings not yet applied   |

## shadcn/ui mapping

`card`, `popover` → `surface` (foreground → `foreground`) · `muted`, `accent`
→ `secondary` · `muted-foreground` → `muted-foreground` · `destructive` →
`danger` · `input`, `ring`, `border` as above.

## Contrast

Every text token is at least 4.5:1 on `--background` and `--surface` in both
modes. Status and warning text is placed on `--surface` or `--background`,
not on `--secondary` (light `--warning` is 4.0:1 there).

## App styles

An app style changes how the client looks without changing its colors. The
user picks one in Account → Appearance or on the first-visit picker. It is
saved per browser in `localStorage['em.appStyle']` and set as
`data-app-style` on `<html>` before first paint. Unknown values count as
`classic`.

| Style         | Fonts                              | Look                                                                                 |
| ------------- | ---------------------------------- | ------------------------------------------------------------------------------------ |
| `classic`     | System                             | Cards with status badges (the default)                                               |
| `sonar`       | Geologica                          | Full-width rows, a status dot that rings on each check-in, 7-day power strip         |
| `switchboard` | Unbounded (headings), Onest (body) | A breaker panel: one tile and lever per device, 7-day power strip                    |
| `lamp`        | Onest                              | Large soft cards that glow while the device is online; the device page is a sentence |

### Token contract

Each style sets these on `[data-app-style="<id>"]`. Classic values are also
the `:root` defaults.

| Token                   | Classic value                                             | Purpose                           |
| ----------------------- | --------------------------------------------------------- | --------------------------------- |
| `--app-font-body`       | system UI stack                                           | Body text (`font-sans`)           |
| `--app-font-heading`    | `var(--app-font-body)`                                    | Headings (`font-heading`)         |
| `--radius`              | `0.625rem`                                                | Base radius for every `rounded-*` |
| `--app-surface-ring`    | `color-mix(in oklab, var(--foreground) 10%, transparent)` | Card edge                         |
| `--app-surface-shadow`  | `0 0 transparent`                                         | Card shadow                       |
| `--app-motion-duration` | `150ms`                                                   | Transitions and animations        |
| `--app-motion-ease`     | `cubic-bezier(0.4, 0, 0.2, 1)`                            | Easing                            |
| `--app-backdrop`        | `var(--background)`                                       | Page background                   |

### Rules

- Colors come only from the theme tokens above. A style derives extra
  shades with `color-mix()` from them, never hex. Light and dark work in
  every style.
- A style changes only its tokens, its three slot components
  (`StatusMark`, `DeviceSummary`, `DeviceHero`) and its own `style.css`.
  Rules in `style.css` target only class names with the style's prefix
  (`.sonar-…`), so a preview of one style inside another stays clean.
- Status is never shown by color or motion alone: every `StatusMark` keeps
  the translated state text, visible or `sr-only`.
- Motion follows an action or a real state change from a poll. The
  exceptions: Sonar's slow ring on an `ONLINE` dot, Sonar's searching arc
  and inward echo on the device page while `OFFLINE`, the live dot next to
  an open outage in the timeline, the looping promo video on auth pages,
  and the entrance (`data-motion="enter"`, staggered by `--i`) of lists,
  the device hero, history rows, channel rows, delivery log rows and
  member rows. The delivery log is a panel below its channel row, outside
  that row's entrance.
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
- Change motion (Classic badge fade, Sonar pulse, Switchboard snap, Lamp
  flicker) plays only while `useStateChange` reports a real change, never
  on mount. `client/src/appStyles/motion.test.tsx` checks the style sheets
  and the first render of every `StatusMark`.
  `prefers-reduced-motion: reduce` sets the motion tokens to `0ms`, turns
  off animation on every `[data-motion]` element and stops the promo
  video (poster with controls).
- Illustrations (`assets/illustrations/`, `Illustration` and `EmptyState`
  in the client) are inlined, so their `var(--primary, …)` style fills
  follow the theme tokens and the light/dark toggle. They are decorative
  (`aria-hidden`); the text next to them carries the meaning.
- The brand mark (`BrandMark`, `assets/logo/`) keeps its own fixed colors
  from `assets/README.md` in every style and theme; it is the only hex
  in components.
- The history grid fills each hour by the share without power with
  `--status-offline`, on a `--status-online` tint; blips are a `--warning`
  dot. Every cell has a text label.

### Adding a style

1. Create `client/src/appStyles/<id>/` with `index.tsx` and `style.css`.
2. Add the ID to `appStyleIds` and the definition to `appStyles` in
   `registry.ts`, and the ID to the inline script in `client/index.html`.
3. Implement the three slots and set `deviceListClassName`.
4. Load fonts in `loadFonts()` with a dynamic `@fontsource-variable/*`
   import (Cyrillic included). Classic loads none.
5. Import `style.css` from `client/src/styles.css`, after `classic`.
6. Add `app.appStyle.<id>.name` and `.description` in `uk`, `en`, `ru`.

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
- Popovers are never wider than the screen.
- Segmented controls scroll sideways on phones instead of wrapping.
- Pages never set control heights or text smaller than `text-xs`;
  `components/ui/consistency.test.ts` enforces both.
