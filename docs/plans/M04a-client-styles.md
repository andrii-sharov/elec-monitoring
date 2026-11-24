# M4a — App styles, icons and motion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the client gets four switchable app styles (Classic, Sonar, Switchboard, Lamp), Lucide icons where they help, an account menu in the header, an Appearance section in Account, a style picker on first sign-in, and motion that shows what changed.

**Architecture:** An app style is a registry entry plus a folder. It changes the look through three layers only:

1. **Tokens.** CSS custom properties set on `[data-app-style="<id>"]`: fonts, radius, surface edge and shadow, motion duration and easing, page backdrop. Custom properties inherit, so a preview nested inside another style gets its own values without extra selectors.
2. **Slots.** Three React components whose markup differs per style: `StatusMark`, `DeviceSummary` (one item of the devices list) and `DeviceHero` (top of the device page). Pages get them from `useAppStyle().slots`. A missing slot is a type error.
3. **Style CSS.** Each `style.css` holds its token block and rules for class names that only its own slot components render (prefix `<id>-`, e.g. `.sonar-ring`). It never targets shared components, so styles can't leak into each other or into previews.

Colors stay in [theme.md](../theme.md). Styles derive extra shades with `color-mix()` from the theme tokens, never hex. Light and dark keep working in every style. Page logic, data fetching and forms exist once.

**Tech Stack:** as [M4](M04-client.md). New: `@fontsource-variable/geologica`, `@fontsource-variable/onest`, `@fontsource-variable/unbounded` (Cyrillic included). Lucide (`lucide-react`) is already installed. Route crossfades use React Router's `viewTransition` on `Link`/`NavLink` (View Transitions API, no fallback needed: without it the navigation is instant). Check `@fontsource-variable` import paths and React Router `viewTransition` against current docs (context7) before writing code.

**Spec:** [PROJECT_V2.md](../PROJECT_V2.md) §9 Client app · [theme.md](../theme.md) · [ROADMAP.md § M4](../ROADMAP.md#m4--client-app).

## Global Constraints

- Everything from the [M4 constraints](M04-client.md#global-constraints) still applies (no hex or Tailwind palette colors in components, `app.*` keys in `uk`, `en`, `ru`, MSW with `onUnhandledRequest: 'error'`, no comments).
- **No server, API or database change.** App style is a per-browser preference like theme.
- A style may only change tokens, its own slots and its own `style.css`. No `if (style === …)` in shared components or pages.
- Fonts are imported lazily by the style's `loadFonts()`. Classic loads none.
- `prefers-reduced-motion: reduce` turns off every animation and transition the plan adds. One rule in `styles.css` sets the motion tokens to `0ms` and `animation: none` on `[data-motion]` elements.
- Motion fires on a person's action or on a real state change from a poll, never on a timer loop. Exceptions: Sonar's slow idle pulse on an `ONLINE` dot, which is the style's single ambient motion, and the one page-load sequence on the devices list.
- Status is never shown by color or motion alone. Every `StatusMark` keeps the translated state text (visible or `sr-only`), so existing tests that find `Online` / `Offline` keep passing.
- Do not use the words "power off" for `OFFLINE`. An offline device means lost contact. The cause is estimated after it returns (P §4).

## Decisions made in this plan

Task 12 records them in the spec and theme.md.

1. **Style IDs** `classic` (default), `sonar`, `switchboard`, `lamp`, stored in `localStorage['em.appStyle']` and applied as `data-app-style` on `<html>` by the inline script in `index.html` before first paint. An unknown stored value counts as `classic`.
2. **One preference store.** `createPreference({ key, choices, fallback, apply })` backs both theme and app style. `theme.ts` is rewritten on top of it with the same public API (`themeChoices`, `useTheme`, `readTheme`, `applyTheme`).
3. **Appearance card** on Account, separate from the Profile form. Theme (system / light / dark) and App style apply instantly and say so ("Saved in this browser"). Language, name and timezone stay in Profile with its **Save** button.
4. **First-visit picker.** A signed-in page load in a browser with no `em.appStyle` sends the user to `/welcome/appearance?next=<path>`. **Use this style** or **Keep Classic** saves the choice and goes to `next`. The redirect happens once per browser. Sign-up can't trigger it directly, because sign-up doesn't sign in (it ends on "Check your email"), and Google sign-up returns like a login.
5. **Header:** logo and nav (Devices, Notifications) on the left. On the right, an account menu button (initial of the name, then the name on `sm` and up) with **Account**, **API docs** (opens in a new tab) and **Sign out**. The language switcher leaves the signed-in header. It stays on signed-out pages (`AuthLayout`).
6. **Live state duration:** `DeviceHero` in Sonar, Switchboard and Lamp shows "Power on for 3 h 12 min" (`ONLINE`), "No contact for 25 min" (`OFFLINE`), "Waiting for the first check-in" (`PENDING`), "Updating" (`UPDATING`). It ticks every 30 s from `state_since`, with the shared duration formatter.
7. **Power strip** (Switchboard and Sonar device page): the last 7 days split into `on`, `outage`, `blip` and `unknown` segments, built from the outages already loaded. If more pages exist, time before the oldest loaded outage is `unknown`, never `on`. The device has no creation time in the API, so a device younger than 7 days shows `on` before it existed. This is accepted until M9 stats.
8. **State-change motion:** `useStateChange(state)` returns `changed: boolean` for one animation cycle when a poll brings a different state than the previous render. It never fires on the first render. Each style's `StatusMark` uses it for its own animation.
9. **Icons:** Lucide only, `aria-hidden`, next to text, never instead of it. Exception: the account menu button, which has an `aria-label`. Emoji status markers (🟢 🔴 ⚪ ⚡ 🔌) in the client are replaced. Telegram messages keep their emoji.

## Review Focus

1. **Nested previews.** The picker renders four previews inside a page that has its own `data-app-style`. Each preview must look like its own style, with no tokens or rules from the page's style. Covered by the "own class prefix only" rule and checked by hand.
2. **First-visit redirect loops.** `/welcome/appearance` must never redirect to itself, `next` goes through `safeNext`, and **Keep Classic** writes the key so the redirect stops. Tests in Task 10.
3. **Power strip honesty.** Unloaded history is `unknown`, an open outage runs to now, and segments never overlap or exceed the window. Tests in Task 4.
4. **Reduced motion and focus.** Every new interactive element has a visible focus ring, and nothing moves with reduced motion on.
5. **Flash of the wrong style.** The inline script sets the style before React loads. A font swap (`font-display: swap`) is acceptable. A layout or color flash is not.

---

## File structure

```
client/index.html                              inline script also sets data-app-style
client/src/styles.css                          font/motion tokens in @theme, imports style CSS, reduced-motion rule
client/src/lib/preference.ts                   createPreference (new)
client/src/lib/preference.test.ts
client/src/lib/theme.ts                        rebuilt on createPreference
client/src/appStyles/registry.ts               ids, AppStyleDefinition type, lookup
client/src/appStyles/AppStyleProvider.tsx      context, useAppStyle(), useAppStylePreference()
client/src/appStyles/registry.test.ts
client/src/appStyles/classic/{index.tsx,style.css}
client/src/appStyles/sonar/{index.tsx,style.css}
client/src/appStyles/switchboard/{index.tsx,style.css}
client/src/appStyles/lamp/{index.tsx,style.css}
client/src/appStyles/slots.ts                  slot prop types
client/src/components/StateDuration.tsx        live "Power on for …"
client/src/components/PowerStrip.tsx
client/src/lib/powerStrip.ts                   segment maths
client/src/lib/powerStrip.test.ts
client/src/lib/useStateChange.ts
client/src/lib/useStateChange.test.ts
client/src/app/Layout.tsx                      new header
client/src/app/AccountMenu.tsx
client/src/app/AccountMenu.test.tsx
client/src/components/AppStylePicker.tsx       used by Account and Welcome
client/src/pages/account/AppearanceCard.tsx
client/src/pages/welcome/WelcomeAppearancePage.tsx
client/src/pages/welcome/WelcomeAppearancePage.test.tsx
client/src/app/RequireAppearance.tsx
shared/src/i18n/*                              app.appearance.*, app.appStyle.*, app.welcome.*, app.nav.*, app.device.duration.*
docs/theme.md, docs/PROJECT_V2.md, docs/ROADMAP.md
```

---

### Task 1: Preference store, registry and tokens

**Files:**

- Create: `client/src/lib/preference.ts`, `client/src/lib/preference.test.ts`, `client/src/appStyles/registry.ts`, `client/src/appStyles/slots.ts`, `client/src/appStyles/AppStyleProvider.tsx`, `client/src/appStyles/registry.test.ts`
- Modify: `client/src/lib/theme.ts`, `client/index.html`, `client/src/styles.css`, `client/src/main.tsx` (or `providers.tsx`), `client/package.json`

**Interfaces:**

```ts
type Preference<T extends string> = {
  read(): T;
  write(value: T): void;
  use(): [T, (value: T) => void];
};
function createPreference<T extends string>(options: {
  key: string;
  choices: readonly T[];
  fallback: T;
  apply(value: T): void;
}): Preference<T>;

const appStyleIds = ['classic', 'sonar', 'switchboard', 'lamp'] as const;
type AppStyleId = (typeof appStyleIds)[number];

type AppStyleDefinition = {
  id: AppStyleId;
  loadFonts(): Promise<unknown>;
  slots: {
    StatusMark: ComponentType<StatusMarkProps>;
    DeviceSummary: ComponentType<DeviceSummaryProps>;
    DeviceHero: ComponentType<DeviceHeroProps>;
  };
  deviceListClassName: string;
};
```

- `AppStyleProvider({ id?, children })`: without `id` it follows the stored preference, with `id` it pins a style (previews). It sets nothing on `<html>`. Previews wrap their content in `<div data-app-style={id}>`.
- Token contract in `styles.css` `:root` (Classic values = today's look): `--app-font-body`, `--app-font-heading`, `--radius`, `--app-surface-ring`, `--app-surface-shadow`, `--app-motion-duration`, `--app-motion-ease`, `--app-backdrop`. `@theme inline` maps `--font-sans` → `--app-font-body` and `--font-heading` → `--app-font-heading`. `Card` reads the surface tokens instead of the fixed `ring-1 ring-foreground/10`.
- Inline script: same `try` block, reads `em.appStyle`, validates against the four IDs, sets `document.documentElement.dataset.appStyle`.

- [ ] **Step 1: Tests:**
  - `createPreference`: missing or unknown value → fallback. `write` stores, calls `apply` and re-renders subscribers.
  - Theme keeps its current behaviour (existing `theme.test.ts` passes unchanged).
  - Registry: every ID has a definition and an `app.appStyle.<id>.name` key in all three languages.
- [ ] **Step 2:** Run → FAIL, implement, → PASS. Classic is registered with stub slots that render today's markup (Task 5 completes it). Run `npm run build -w client` to check the CSS imports and Lightning CSS output.
- [ ] **Commit point:** `client/ shared/src/i18n/` — `Add app style registry and preferences`

### Task 2: Header, account menu and route transitions

**Files:**

- Create: `client/src/app/AccountMenu.tsx`, `client/src/app/AccountMenu.test.tsx`
- Modify: `client/src/app/Layout.tsx`, locales (`app.nav.menu`, `app.nav.signOut`)

**Interfaces:**

- Header: `Zap` logo mark + "Elec", nav with `Cpu` Devices and `Bell` Notifications (`NavLink viewTransition`). Account menu on the right (`DropdownMenu`): `UserRound` Account, `BookOpen` API docs (`target="_blank" rel="noreferrer"`, `ExternalLink` hint), separator, `LogOut` Sign out (`useSession().signOut`).
- On narrow screens nav labels stay, icons shrink, and the header wraps no worse than today.
- `::view-transition-old/new(root)` crossfade with the motion tokens. The header gets `view-transition-name: app-header` so it stays still while the page changes.

- [ ] **Step 1: Tests:** the menu opens with the keyboard, shows the three items, **API docs** links to `${apiUrl()}/api/docs`, **Sign out** calls the logout endpoint (MSW) and lands on `/login`. The signed-in header has no language select.
- [ ] **Step 2:** Run → FAIL, implement, → PASS.
- [ ] **Commit point:** `client/ shared/src/i18n/` — `Add account menu to header`

### Task 3: Motion primitives and live duration

**Files:**

- Create: `client/src/lib/useStateChange.ts`, `client/src/lib/useStateChange.test.ts`, `client/src/components/StateDuration.tsx`, `client/src/components/StateDuration.test.tsx`
- Modify: `client/src/styles.css` (shared keyframes, reduced-motion rule), locales (`app.device.duration.*`)

**Interfaces:**

- `useStateChange<T>(value: T): boolean`: `true` for the render after the value changes, then `false` after `--app-motion-duration` (or on `animationend` via a returned handler). Never `true` on mount.
- `StateDuration({ state, since })`: the text from Decision 6, ticking every 30 s.
- Page-load sequence: the devices list items get `data-motion="enter"` with a staggered `animation-delay` from a `--i` index, so the stagger is CSS-only.

- [ ] **Step 1: Tests:** `useStateChange` is false on mount, true after a change, false again after the timer (fake timers). `StateDuration` shows "Power on for 3 h 12 min" at a fixed clock and updates after 30 s. `OFFLINE` shows "No contact for …".
- [ ] **Step 2:** Run → FAIL, implement, → PASS.
- [ ] **Commit point:** `client/ shared/src/i18n/` — `Add state change hook and live duration`

### Task 4: Power strip

**Files:**

- Create: `client/src/lib/powerStrip.ts`, `client/src/lib/powerStrip.test.ts`, `client/src/components/PowerStrip.tsx`

**Interfaces:**

```ts
type StripSegment = {
  kind: 'on' | 'outage' | 'blip' | 'unknown';
  start: number;
  end: number;
};
function buildPowerStrip(input: {
  outages: OutageItem[];
  now: number;
  windowMs: number;
  complete: boolean;
}): StripSegment[];
```

- `PowerStrip({ deviceId })` uses the same `useOutages` query as the timeline (no extra request). It renders a horizontal bar with one element per segment, sized by percentage, day ticks below, and an `sr-only` summary ("2 outages and 1 blip in the last 7 days"). Hovering or focusing a segment shows its range in a tooltip.

- [ ] **Step 1: Tests (pure function):**
  - No outages, `complete` → one `on` segment.
  - No outages, not complete → one `unknown` segment.
  - An open outage → `outage` runs to `now`.
  - An outage that started before the window is clipped to the window start.
  - With 20 loaded and more pages, time before the oldest start is `unknown`.
  - A `POWER_BLIP` → `blip`, given a minimum visible width only in the component, not in the data.
  - Segments are sorted, contiguous, don't overlap, and sum to `windowMs`.
- [ ] **Step 2:** Run → FAIL, implement, → PASS.
- [ ] **Commit point:** `client/` — `Add 7-day power strip`

### Task 5: Classic style and slot-based pages

**Files:**

- Modify: `client/src/appStyles/classic/*`, `client/src/pages/devices/DevicesPage.tsx`, `client/src/pages/devices/DevicePage.tsx`, `client/src/components/StatusBadge.tsx` (becomes Classic's `StatusMark`), `client/src/pages/devices/OutageTimeline.tsx`

**Interfaces:**

- `DevicesPage` renders `<ul className={style.deviceListClassName}>` with `<slots.DeviceSummary device={…} index={i} />`. `DevicePage` renders `<slots.DeviceHero device={…} />` in place of today's header block. Loading, error, empty and not-found states stay shared.
- Classic keeps today's layout. Status badge uses a Lucide `Circle` filled with the status color instead of emoji. Timeline rows use `PlugZap` (outage) and `Zap` (blip). Badge crossfade on state change.

- [ ] **Step 1:** Existing page tests pass with no changes beyond emoji assertions. Add one test: switching the stored style re-renders `DevicesPage` with that style's `DeviceSummary` (check its `data-app-style-slot` attribute).
- [ ] **Step 2:** Implement → PASS.
- [ ] **Commit point:** `client/` — `Render device pages through style slots`

### Task 6: Sonar style

**Files:** `client/src/appStyles/sonar/{index.tsx,style.css}`, `client/package.json` (Geologica)

- **Tokens:** Geologica for body and headings (headings at a higher weight). `--radius` 1rem. Surfaces without a ring, a soft depth shadow from `color-mix(in oklab, var(--primary) 18%, transparent)`. Backdrop: a vertical gradient from `--background` to a slightly deeper mix of `--background` and `--primary`. Motion: 600 ms, `cubic-bezier(.2,.7,.2,1)`.
- **Device list:** full-width rows. Large status dot on the left, then the name, then `StateDuration` on the right.
- **StatusMark:** a dot. `ONLINE` has one slow ring every 4 s (the style's single ambient motion). A new check-in (`last_seen_at` changes) or a state change sends one stronger ring. `OFFLINE` is a hollow dot with no ring. `PENDING` / `UPDATING` is a dashed outline.
- **DeviceHero:** large `StateDuration` as the page's main line, then the name, then the `PowerStrip`.

- [ ] **Step 1:** Implement. Unit test: the `StatusMark` gets `data-pulse` when `last_seen_at` changes between renders.
- [ ] **Step 2:** Build and test → PASS.
- [ ] **Commit point:** `client/` — `Add Sonar app style`

### Task 7: Switchboard style

**Files:** `client/src/appStyles/switchboard/{index.tsx,style.css}`, `client/package.json` (Unbounded, Onest)

- **Tokens:** Unbounded for headings and device names, Onest for body. `--radius` 0.375rem. Surfaces have a 1 px `--border` edge and an inset top highlight mixed from `--surface` and `--foreground`. Motion: 220 ms, a slight overshoot ease for the lever.
- **Device list:** a "panel" grid of square-ish breaker tiles (2 columns on mobile, 3–4 wide), each with a lever, the name, and `StateDuration` underneath.
- **StatusMark:** a lever drawn in CSS. Up and `--status-online` for `ONLINE`, down and `--status-offline` for `OFFLINE`, middle and `--status-pending` otherwise. On a state change it snaps to the new position with the overshoot.
- **DeviceHero:** the breaker tile at a larger size beside `StateDuration`, with the `PowerStrip` full width below.

- [ ] **Step 1:** Implement. Unit test: the lever position attribute matches the state.
- [ ] **Step 2:** Build and test → PASS.
- [ ] **Commit point:** `client/` — `Add Switchboard app style`

### Task 8: Lamp style

**Files:** `client/src/appStyles/lamp/{index.tsx,style.css}`, `client/package.json` (Onest)

- **Tokens:** Onest for body and headings, headings large with tight tracking. `--radius` 1.5rem. Generous card padding. Motion: 900 ms ease-out.
- **Device list:** cards. An `ONLINE` card has a radial glow from `color-mix(in oklab, var(--warning) 35%, transparent)` behind a `Lightbulb` icon. `OFFLINE` cards drop to muted text with `LightbulbOff`. On page load and on a state change to `ONLINE`, the glow flickers on once (three quick opacity steps, then steady).
- **StatusMark:** the bulb icon with the state text.
- **DeviceHero:** one sentence in large type, e.g. "The power is on at Home, 3 hours now" or "No contact with Garage for 25 minutes". Telemetry goes below in normal text.

- [ ] **Step 1:** Implement. Unit test: the hero sentence for `ONLINE` and `OFFLINE` with a fixed clock.
- [ ] **Step 2:** Build and test → PASS.
- [ ] **Commit point:** `client/ shared/src/i18n/` — `Add Lamp app style`

### Task 9: Appearance card and style picker

**Files:**

- Create: `client/src/components/AppStylePicker.tsx`, `client/src/pages/account/AppearanceCard.tsx`, `client/src/pages/account/AppearanceCard.test.tsx`
- Modify: `client/src/pages/account/ProfileForm.tsx` (theme removed), `client/src/pages/account/AccountPage.tsx` (Appearance after Profile), locales (`app.appearance.*`, `app.appStyle.<id>.name` / `.description`)

**Interfaces:**

- `AppStylePicker({ value, onChange })`: a `radiogroup` of four options. Each option is a live miniature: `AppStyleProvider id={id}` + `data-app-style={id}` around a sample `DeviceSummary` for a fake `ONLINE` device named "Home", plus the style's name and one-line description. On mount it calls every style's `loadFonts()`. Arrow keys move the selection, and the selected option has a check and a visible ring.
- Theme becomes a three-option segmented control (`Monitor` / `Sun` / `Moon`).
- `AppearanceCard`: title, "Saved in this browser" hint, theme control, `AppStylePicker`. Both apply immediately.

- [ ] **Step 1: Tests:** choosing Sonar sets `data-app-style="sonar"` on `<html>` and `localStorage['em.appStyle']`. Choosing Dark sets `class="dark"`. The Profile form no longer contains a theme field, and its **Save** button is still disabled until a profile field changes.
- [ ] **Step 2:** Run → FAIL, implement, → PASS.
- [ ] **Commit point:** `client/ shared/src/i18n/` — `Move theme into Appearance card`

### Task 10: First-visit style picker

**Files:**

- Create: `client/src/app/RequireAppearance.tsx`, `client/src/pages/welcome/WelcomeAppearancePage.tsx`, `client/src/pages/welcome/WelcomeAppearancePage.test.tsx`
- Modify: `client/src/app/router.tsx`, locales (`app.welcome.*`)

**Interfaces:**

- Routes: `RequireAuth` → `/welcome/appearance` (outside `Layout`, full page), and `RequireAuth` → `RequireAppearance` → `Layout` → the existing pages.
- `RequireAppearance`: if `localStorage['em.appStyle']` is missing, redirect to `/welcome/appearance?next=<path+search>`. Otherwise render `<Outlet />`.
- Welcome page: greeting with the user's name, a short line ("Choose how Elec looks. You can change it any time in Account."). Selecting an option previews it on the **whole page** at once, through a pinned provider and `data-app-style` on the page root, without saving. Theme control. **Use this style** saves and goes to `safeNext(next)`. **Keep Classic** saves `classic` and goes to `next`. Entrance: the four options rise in one staggered sequence.

- [ ] **Step 1: Tests:**
  - A signed-in user with no stored style who opens `/devices/abc` → welcome page. **Use this style** with Lamp selected → stored `lamp`, lands on `/devices/abc`.
  - **Keep Classic** → stored `classic`, lands on `/devices`.
  - With a stored style, `/devices` renders directly.
  - `next=//evil.example` → `/devices`.
  - Opening `/welcome/appearance` with a stored style still works (reachable, no redirect loop).
- [ ] **Step 2:** Run → FAIL, implement, → PASS.
- [ ] **Commit point:** `client/ shared/src/i18n/` — `Add first-visit style picker`

### Task 11: Icons across the remaining pages

**Files:** `client/src/pages/**`, `client/src/app/VerifyBanner.tsx`, `client/src/forms/FormAlert.tsx`, `client/src/pages/auth/AuthLayout.tsx`

- Add device (`Plus`), wizard steps (`Tag`, `KeyRound`, `Radio`), pairing code copy (`Copy` → `Check` for 1.5 s after copying), retry (`RotateCw`), empty devices (`PlugZap` in a large muted circle), verify banner (`MailWarning`), form alerts (`CircleAlert`), Telegram (`Send`), channels (`BellRing`), sessions (`MonitorSmartphone`), danger zone (`TriangleAlert`, `Trash2`, `RefreshCcw`), password show/hide (`Eye` / `EyeOff`, if a toggle exists), Google button keeps its brand mark.
- Auth pages: the logo mark above the card and the language switcher top-right (it stays).

- [ ] **Step 1:** Existing tests pass, since icons are `aria-hidden`.
- [ ] **Commit point:** `client/` — `Add icons across client pages`

### Task 12: Docs and roadmap

**Files:** `docs/theme.md`, `docs/PROJECT_V2.md`, `docs/ROADMAP.md`

- theme.md: a new "App styles" section with the four styles, the token contract table (token, Classic value, purpose), the rules (colors only from theme tokens via `color-mix`, own class prefix, reduced motion), and how to add a style (folder, registry line, three slots, `app.appStyle.<id>.*` keys, `loadFonts`).
- PROJECT_V2 §9: Pages → Devices and Device describe slots and the live duration. Account → "Appearance: theme and app style, saved in this browser". New **Welcome** item for the first-visit picker. Header and account menu. Emoji → icons.
- ROADMAP: M4 plan column links M04a. Add M4 deliverable `- [ ] App styles, icons, account menu and motion ([M04a](plans/M04a-client-styles.md))`. Add 👤 checks to M4 "Done when".
- [ ] **Commit point:** `docs/` — `Document app styles`

---

## Manual checks (👤)

Verify by hand:

- Each of the four styles in light and dark on Devices, Device, Account, Notifications and Add device, at phone width and desktop.
- Pickers on Account and Welcome: each preview looks like its own style whatever the current style is.
- First sign-in in a fresh browser profile opens the picker. Reload after choosing doesn't.
- A device going offline and back while the page is open: Sonar ring, Switchboard lever snap, Lamp flicker, each once.
- macOS "Reduce motion" on: nothing animates, and everything is still readable.
- Reload on each style: no flash of Classic colors or layout before the style applies.
- Keyboard only: account menu, style picker (arrow keys), theme control, power strip segments.
