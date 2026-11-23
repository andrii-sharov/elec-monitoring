# M4 — Client app Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** users sign up or sign in (password or Google), add a device, watch its state and outage history, change its settings, connect the platform Telegram bot and manage their account, in a React app on Vercel.

**Architecture:** The `/api/auth` and `/api/v1` request and response Zod schemas move from `server/` to `@elec/shared/api`, so the server, its OpenAPI document and the client use one definition. `client/` is a Vite SPA. One `ApiClient` owns the access token in memory, refreshes through the `em_refresh` cookie on load and on `401`, and parses every response with the shared schema. TanStack Query holds server state and polls where the UI waits for a device or Telegram. Forms use React Hook Form with the shared schemas, and Zod issues and API error codes are translated through i18next with the shared dictionaries. The server gains one endpoint, `DELETE /api/v1/channels/:id`.

**Tech Stack:** Node.js 26, TypeScript 7, Vite 8, React 19, React Router 8 (data mode, `createBrowserRouter`), TanStack Query 5, Tailwind CSS 4 with `@tailwindcss/vite`, shadcn 4 (CLI-generated components), React Hook Form 7 + `@hookform/resolvers` 7, Zod 4, i18next 27 + react-i18next 18, lucide-react. Tests: Vitest 5 with jsdom 31, Testing Library (`react`, `user-event`, `jest-dom`), MSW 3. Check setup details for Vite 8, React Router 8, Tailwind 4 and shadcn 4 against current docs (context7) before writing config.

**Spec:** [ROADMAP.md § M4](../ROADMAP.md#m4--client-app) · [PROJECT_V2.md](../PROJECT_V2.md) §3 (sessions, Google), §4 Adding a device, §5 Device settings, §9 Client app and Localization, §12 Vercel and CI/CD · [API.md](../API.md) §1, §3, §4 Devices, Outages, Notification channels, Account · [theme.md](../theme.md).

## Global Constraints

- Everything from the [M0](M00-foundation.md#global-constraints)–[M3](M03-worker-telegram.md#global-constraints) constraints still applies (ESM, strict TS, no comments, no real names, error shape, `404` for inaccessible devices). **No migration in M4.**
- The access token lives only in `ApiClient` memory. Never write it to `localStorage`, `sessionStorage` or a cookie. Only `/api/auth/*` requests use `credentials: 'include'`.
- Every request body and response type in `client/` comes from `@elec/shared/api` (`z.input` / `z.output`). No hand-written API types in the client.
- `shared/src` stays runtime-neutral: no `node:` imports, `Buffer` or `process` (lint rule in Task 4). One `zod` copy in the tree: `npm ls zod` shows a single deduped version.
- The OpenAPI document does not change in Tasks 1–2. Task 3 changes it only by the new `DELETE` operation.
- All user-facing text uses `app.*` i18n keys present in `uk`, `en` and `ru` (parity test). No i18next plural suffixes or `count` variable (M3 rule). API error codes are shown through `app.errors.<code>`.
- Colors come only from the [theme.md](../theme.md) tokens through Tailwind theme variables. No hex values or Tailwind palette colors (`bg-red-500`) in components.
- Tests make no real HTTP: MSW `setupServer` with `onUnhandledRequest: 'error'`. Polling and expiry tests use `vi.useFakeTimers({ shouldAdvanceTime: true })`.
- `VITE_API_URL` is the only build-time setting: an origin with no trailing slash. Dev default `http://localhost:3000`.
- Out of M4 (later milestones own them): stats (M9), members and invites (M6), firmware version, updates and flashing (M5, M11), `auto_update` (M11), own bot, webhooks and the delivery log (M8), API tokens (M7), Wi-Fi diagnostics.

## Decisions made in this plan

Each task records its decisions in the spec. Task 13 marks them in the ROADMAP.

1. **Shared schemas.** `@elec/shared/api` (subpath export) holds the client-facing schemas: auth bodies and session, `/me`, devices, outages, channels, the error body. Device-API (claim, ping), diagnostics, Google query and config schemas stay in `server/`. Shared schemas carry no inline English messages: the quiet-hours refine uses `params: { reason: 'same_time' }` instead of `message`. The server's error `details` don't change (`code` comes from the issue code).
2. **Client parses responses** with the shared schema. Unknown keys are stripped. A parse failure throws `ApiError` with code `invalid_response` and is shown as the generic error.
3. **Formatting moves to shared.** `formatDuration`, `formatMoment` and `formatRange` move from `server/src/notifications/format.ts` to `shared/src/format.ts`. Their keys move from `telegram.duration.*` to `common.duration.*`. `isQuietTime` stays in the server.
4. **`DELETE /api/v1/channels/:id`** (scope `write`, verified user, the channel's owner). `204`. Missing or another user's channel → `404 not_found`. Cascades the device links and the delivery log. Nothing is sent to Telegram. `PATCH /channels/:id` waits for M8.
5. **Refresh.** One refresh on app load. A request sent with a bearer token that gets `401 unauthorized` triggers one shared (single-flight) refresh and is retried once. A refresh `409` is retried once after 300 ms. A refresh `401`, or a second `401`, signs out locally and sends the user to `/login?next=<current path>`. Requests sent without a bearer token (`login`, `signup`, `refresh`) never trigger a refresh. No proactive timer.
6. **`next` redirects** accept only a path that starts with `/` and not `//` or `/\`. Anything else becomes `/devices`.
7. **Language.** Signed in: `/me.language`. Signed out: `localStorage['em.language']`, then the first of `navigator.languages` whose prefix is `uk`, `en` or `ru`, then `uk`. The switcher on signed-out pages writes `localStorage`. Signed in, it also sends `PATCH /me`. Sign-up sends the current UI language and the browser timezone (`Europe/Kyiv` if unknown).
8. **Times** show in `/me.timezone` and language through the shared formatters ("21 Nov 18:42", "2 h 15 min"). Signed out, the browser timezone.
9. **Polling** (paused in hidden tabs, the TanStack default): devices list 30 s; device page 15 s; add-device wizard 3 s while `PENDING`; Telegram connect 3 s until a new channel ID appears or the link expires.
10. **Unverified email:** a banner on every signed-in page with **Resend email** (`204` → toast, `429` → toast with the wait). "Add device" and "Connect Telegram" are disabled with a hint. The API already blocks these with `403 email_not_verified`.
11. **Google.** `startGoogle(intent, next)` stores `{ intent, next }` in `sessionStorage['em.google']` and navigates to `${VITE_API_URL}/api/auth/google?app=CLIENT&intent=…`. `/auth/google` shows `app.google.errors.<error>` when `?error=` is present. Otherwise it refreshes and goes to `next`: `/devices` by default for `LOGIN`, `/account` for `LINK`. A Google-only user who gets `reauth_required` on delete is offered **Sign in with Google again**, which uses `startGoogle('LOGIN', '/account?confirmDelete=1')`. The Account page opens the delete dialog when `confirmDelete=1`.
12. **Device settings form units:** ping interval and offline timeout in seconds, short-outage threshold in whole minutes (1–1440, sent × 60). `auto_update` is hidden until M11. The form checks `offline_timeout_s ≥ 2 × ping_interval_s` before submit, with the same detail the server returns. `settings_sync.pending` shows "Waiting for the device to apply" in `--warning`.
13. **Role-aware UI now:** settings, re-pair, rotate token and delete render only for `role === 'OWNER'`. The timeline and the device's channel choice show for every role (viewers attach their own channels from M6). The server still enforces access.
14. **Theme** per [theme.md](../theme.md): `system` (default), `light` or `dark` in `localStorage['em.theme']`, applied as `class="dark"` on `<html>` by an inline script in `index.html` before first paint.
15. **Vercel:** project rooted at `client/`, `client/vercel.json` rewrites everything to `/index.html` (files are served first). The `v2` branch deploys to `https://staging-app.elec-monitoring.homes`. `VITE_API_URL` is the staging API for Preview and the `v2` branch. Production domains wait for M12. Preview `*.vercel.app` URLs can't sign in (CORS and cookie are for the stable origins only, P §12).

## Review Focus

1. **Two tabs (or React StrictMode) refresh at the same moment** → one gets `409`, retries once and signs in. Nobody is logged out and no refresh loop starts. Tests in Task 5.
2. **The access token expires while four queries are in flight** → exactly one `POST /api/auth/refresh`, all four retried once and resolved. If the refresh answers `401`, one redirect to `/login?next=…`, not four. Tests in Task 5.
3. **Reload of a deep link `/devices/<id>` while signed out** → login → back on that device. `next=//evil.example` or `next=https://evil.example` → `/devices`. Tests in Task 6.
4. **The pairing code expires while the wizard waits** → the wizard stops polling and offers a new code. The device checking in stops the polling and shows 🟢. Tests in Task 8.
5. **Offline timeout below 2 × ping interval** → a translated inline error before submit. A server `400` detail on any settings field lands on that field. An unknown detail path shows as a form error. Tests in Task 10.

---

## File structure

```
shared/package.json                     + zod dependency, "./api" export
shared/src/api/index.ts                 re-exports
shared/src/api/common.ts                errorCodes, ErrorCode, errorSchema, isoDate, page(itemSchema)
shared/src/api/auth.ts                  email/password/name/language/timezone schemas, auth bodies, sessionSchema
shared/src/api/account.ts               meSchema, mePatchSchema, meDeleteSchema
shared/src/api/devices.ts               device, settings, outage schemas, device bodies, outagesQuerySchema
shared/src/api/channels.ts              channelSchema, telegramLinkSchema, channelIdsSchema, putChannelIdsSchema
shared/src/format.ts                    formatDuration, formatMoment, formatRange (moved)
shared/src/i18n/locales/{uk,en,ru}.ts   common.duration.*, app.*
server/src/http/**                      import schemas from @elec/shared/api
server/src/http/openapi.snapshot.test.ts  + __snapshots__/openapi.json
server/src/http/channels/channels.ts    + DELETE /api/v1/channels/:id
client/                                 new workspace (see Task 4)
client/src/api/{client,errors,session,endpoints,queries}.ts(x)
client/src/forms/zodErrors.ts
client/src/lib/{config,i18n,theme,format,safeNext}.ts
client/src/app/{router,providers,Layout}.tsx
client/src/pages/{auth,devices,notifications,account}/*.tsx
client/test/{setup,server,render,fixtures}.ts(x)
client/vercel.json
```

Tests sit next to the code (`*.test.ts(x)`).

---

### Task 1: Move API schemas to `@elec/shared/api`

**Files:**

- Create: `shared/src/api/{index,common,auth,account,devices,channels}.ts`, `server/src/http/openapi.snapshot.test.ts`, `server/src/http/__snapshots__/openapi.json`
- Modify: `shared/package.json`, `server/src/http/app.ts`, `server/src/http/auth/{schemas,signup,session,password}.ts`, `server/src/http/account/me.ts`, `server/src/http/devices/{views,devices,history}.ts`, `server/src/devices/settings.ts`, `server/src/channels/views.ts`, `server/src/http/channels/channels.ts`, `server/src/http/errors.ts`, `.oxlintrc.json`
- Docs: `docs/PROJECT_V2.md` §13 (`shared/` also holds API schemas)

**Interfaces:**

- Produces (`@elec/shared/api`), names unchanged unless noted:
  - `common.ts`: `errorCodes` (the `ErrorCode` union from `errors.ts` as a const array), `type ErrorCode`, `errorSchema`, `type ErrorDetail` (the server's `ErrorDetail` now imports it), `isoDate`, `page<T extends z.ZodType>(item: T)` → `{ items: T[], next_cursor: string | null }`.
  - `auth.ts`: `emailSchema`, `passwordSchema`, `nameSchema`, `languageSchema`, `timezoneSchema`, `signupBodySchema`, `tokenBodySchema`, `loginBodySchema`, `forgotBodySchema`, `resetBodySchema`, `changePasswordBodySchema` (was `changeBodySchema`), `sessionSchema` (was `sessionResponseSchema`), `type Session`.
  - `account.ts`: `meSchema`, `type Me`, `mePatchSchema`, `meDeleteSchema`.
  - `devices.ts`: `deviceNameSchema`, `quietHoursSchema`, `deviceSettingsSchema`, `settingsPatchSchema`, `outageItemSchema`, `type OutageItem`, `deviceListItemSchema`, `deviceSchema`, `type Device`, `type DeviceListItem`, `deviceListSchema` (`{ items }`), `createDeviceBodySchema`, `devicePatchSchema`, `pairingCodeSchema`, `createDeviceResponseSchema`, `deviceParamsSchema`, `outagesQuerySchema`, `outagesPageSchema` (`page(outageItemSchema)`).
  - `channels.ts`: `channelSchema`, `type Channel`, `channelListSchema`, `telegramLinkSchema` (was `linkResponseSchema`), `channelIdsSchema`, `putChannelIdsSchema` (was `putBodySchema`), `MAX_CHANNEL_IDS = 50`.
- `shared/package.json` `exports["./api"]` mirrors `"."` (`source`, `types`, `default`) for `src/api/index.ts` / `dist/api/index.*`. `zod` goes in `dependencies` with the server's range (`^4.6.7`).
- Server keeps the mappers (`toMe`, `toChannel`, device views), the `zod-openapi` path objects, `HttpError` and `ErrorDetail`.

- [ ] **Step 1: Snapshot test first.** `openapi.snapshot.test.ts` builds the document as `createApp` does and asserts `expect(JSON.stringify(doc, null, 2)).toMatchFileSnapshot('./__snapshots__/openapi.json')`. Run `npm test -w server -- openapi.snapshot -u` on the current code, then without `-u` → PASS. Extract the document building from `createApp` into `export function apiDocument(): OpenApiDocument` in `app.ts` so the test and the app share it.
- [ ] **Step 2: Move** the schemas, update imports, delete the moved definitions from the server. Replace the quiet-hours refine `message` with `params: { reason: 'same_time' }` (decision 1).
- [ ] **Step 3: Lint rule.** `.oxlintrc.json` override for `shared/src/**`: `no-restricted-imports` with pattern `node:*`, and `no-restricted-globals` for `Buffer` and `process`.
- [ ] **Step 4: Verify:** `npm test -w server` → all PASS, including the snapshot unchanged. `npm run typecheck && npm run build && npm run lint`. `npm ls zod` → one version.
- [ ] **Commit point:** `shared/ server/src/ .oxlintrc.json docs/PROJECT_V2.md package-lock.json` — `Move API schemas to shared`

### Task 2: Move duration and time formatting to shared

**Files:**

- Create: `shared/src/format.ts`, `shared/src/format.test.ts`
- Modify: `shared/src/index.ts`, `shared/src/i18n/locales/{uk,en,ru}.ts`, `server/src/notifications/format.ts` (keeps `isQuietTime`, `QuietHours`), `server/src/notifications/format.test.ts`, `server/src/notifications/render.ts`, `server/src/telegram/bot.ts`

**Interfaces:**

- Produces (`@elec/shared`):

  ```ts
  type Translate = (key: DurationKey, options: { value: number }) => string;
  type DurationKey = 'common.duration.seconds' | 'common.duration.minutes' | 'common.duration.hours' | 'common.duration.days';
  formatDuration(seconds: number, t: Translate): string;
  formatMoment(at: Date, language: Language, timezone: string): string;
  formatRange(from: Date, to: Date, language: Language, timezone: string): string;
  ```

- [ ] **Step 1:** Move the `formatDuration`, `formatMoment` and `formatRange` cases from `server/src/notifications/format.test.ts` to `shared/src/format.test.ts` (with a test `t` built from `resources.en`). Run → FAIL.
- [ ] **Step 2:** Move the functions and rename the keys `telegram.duration.*` → `common.duration.*` in all three locales. Server callers pass `(key, o) => t(key, o)`.
- [ ] **Step 3: Verify:** `npm test -w shared && npm test -w server` → PASS (render tests and parity unchanged). OpenAPI snapshot unchanged.
- [ ] **Commit point:** `shared/src/ server/src/notifications/ server/src/telegram/bot.ts` — `Move duration formatting to shared`

### Task 3: `DELETE /api/v1/channels/:id`

**Files:**

- Modify: `server/src/http/channels/channels.ts`, `server/src/http/channels/channels.test.ts`, `server/src/http/__snapshots__/openapi.json`
- Docs: `docs/API.md` §4 Notification channels (decision 4)

**Interfaces:**

- Consumes: `createPlatformChannel`, `linkChannel` from `server/test/channels.ts`.
- Produces: `DELETE /api/v1/channels/{id}` in the OpenAPI `Notifications` tag, `bearerAuth`, path params `{ id: uuid }`, responses `204`, `400`, `401`, `403`, `404`.

- [ ] **Step 1: Tests** (`describe('DELETE /api/v1/channels/:id')`):
  - owner → `204`; the channel, its `device_channel` rows and its `delivery` rows are gone; another channel of the same user is untouched.
  - another user's channel → `404 not_found`, the row still exists.
  - unknown UUID → `404`; `not-a-uuid` → `400 validation_error`.
  - unverified user → `403 email_not_verified`; no token → `401`.
- [ ] **Step 2:** Run → FAIL, implement (`delete … where id and user_id returning id`, `404` when nothing returned), → PASS. Update the snapshot with `-u` and check the diff adds only this operation.
- [ ] **Step 3: Docs** per the Files list.
- [ ] **Commit point:** `server/src/http/ docs/API.md` — `Add channel deletion endpoint`

### Task 4: Client workspace, theme, i18n and test harness

**Files:**

- Create: `client/package.json`, `client/tsconfig.json`, `client/vite.config.ts`, `client/index.html`, `client/components.json`, `client/src/main.tsx`, `client/src/styles.css`, `client/src/app/{providers,router}.tsx`, `client/src/lib/{config,i18n,theme}.ts`, `client/src/lib/{i18n,theme}.test.ts`, `client/src/components/ui/*` (shadcn CLI), `client/src/components/LanguageSwitcher.tsx`, `client/src/pages/NotFound.tsx`, `client/test/{setup,server,render}.ts(x)`
- Modify: root `package.json` (workspace `client`, `build` adds `-w client`), `.oxlintrc.json` (override for `client/**`: plugins `react`, `jsx-a11y`; env `browser`), `.oxfmtrc.json` if shadcn output needs ignoring (it shouldn't), `shared/src/i18n/locales/{uk,en,ru}.ts` (`app.common.*`, `app.errors.*`, `app.theme.*`, `app.notFound.*`)

**Interfaces:**

- `client/package.json` scripts: `dev` (`vite`), `build` (`tsc --noEmit && vite build`), `typecheck` (`tsc --noEmit`), `test` (`vitest run`). Depends on `@elec/shared`.
- `vite.config.ts`: React and Tailwind plugins, `resolve.conditions` and `ssr.resolve.conditions` include `source`; `test`: `environment: 'jsdom'`, `setupFiles: ['test/setup.ts']`, `server.deps.inline: [/@elec\/shared/]`.
- `tsconfig.json`: standalone (not the Node base), `moduleResolution: 'bundler'`, `customConditions: ['source']`, `allowImportingTsExtensions`, `noEmit`, `jsx: 'react-jsx'`, `lib: ['es2024', 'dom', 'dom.iterable']`, `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, path alias `@/*` → `src/*` (shadcn).
- `styles.css`: theme.md tokens as CSS variables on `:root` and `.dark`, mapped to shadcn names per theme.md, exposed with Tailwind `@theme inline` (`bg-surface`, `text-status-online`, …).
- `lib/config.ts`: `apiUrl(): string` from `import.meta.env.VITE_API_URL`, default `http://localhost:3000`, trailing `/` removed.
- `lib/i18n.ts`: `createClientI18n(language: Language): i18n` (shared `resources`); `detectLanguage(storage: Storage, navigatorLanguages: readonly string[]): Language` (decision 7); `rememberLanguage(language)`.
- `lib/theme.ts`: `type ThemeChoice = 'system' | 'light' | 'dark'`; `readTheme(): ThemeChoice`; `applyTheme(choice, prefersDark: boolean): void`; `useTheme(): [ThemeChoice, (c: ThemeChoice) => void]` (listens to `prefers-color-scheme`). `index.html` inline script does the first apply.
- `test/render.tsx`: `renderRoute(path: string, o?: { me?: Me | null }): { user: UserEvent; router }` mounts the real route tree in a memory router with a fresh `QueryClient` (`retry: false`), i18n in `en`, and the session preset (Task 5 fills the session part; until then it renders without one). `test/server.ts` exports the MSW `server`; `setup.ts` starts it with `onUnhandledRequest: 'error'`, resets handlers after each test, and loads `jest-dom` matchers.
- shadcn components generated now: `button`, `input`, `label`, `card`, `badge`, `alert`, `alert-dialog`, `dialog`, `dropdown-menu`, `select`, `switch`, `checkbox`, `skeleton`, `sonner`, `popover`, `command`, `field` (or `form`, whichever shadcn 4 ships for React Hook Form).

- [ ] **Step 1: Tests:**
  - `detectLanguage`: stored `'ru'` → `ru`; nothing stored, `['en-US', 'uk']` → `en`; `['de-DE']` → `uk`; stored `'xx'` → falls through to navigator.
  - `applyTheme('dark', false)` → `<html>` has `dark`; `('system', true)` → `dark`; `('light', true)` → no `dark`.
  - `renderRoute('/nowhere')` shows the translated not-found heading.
- [ ] **Step 2:** Run `npm test -w client` → FAIL, implement, → PASS. `npm test -w shared` (parity) → PASS.
- [ ] **Step 3: Verify:** `npm ci && npm run lint && npm run fmt:check && npm run typecheck && npm run build && npm test` → exit 0 (CI runs the same root scripts, so CI now builds and tests the client).
- [ ] **Commit point:** `client/ package.json package-lock.json .oxlintrc.json shared/src/i18n/` — `Scaffold client app`

### Task 5: API client and session

**Files:**

- Create: `client/src/api/{errors,client,session,endpoints,queries}.ts(x)`, `client/src/api/client.test.ts`, `client/src/api/session.test.tsx`, `client/test/fixtures.ts`, `client/src/lib/safeNext.ts`, `client/src/lib/safeNext.test.ts`
- Modify: `client/src/app/{providers,router}.tsx`, `client/test/render.tsx`

**Interfaces:**

- `errors.ts`: `class ApiError extends Error { status: number; code: ErrorCode | 'network' | 'invalid_response'; details: ErrorDetail[]; retryAfterS: number | null }`; `isApiError(e, code?)`.
- `client.ts`:

  ```ts
  type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  type RequestOptions<S extends z.ZodType | undefined> = {
    method?: HttpMethod; body?: unknown; query?: Record<string, string | number | undefined>; schema?: S;
  };
  interface ApiClient {
    request<S extends z.ZodType | undefined = undefined>(path: string, o?: RequestOptions<S>):
      Promise<S extends z.ZodType ? z.output<S> : void>;
    refresh(): Promise<Session | null>;
    setSession(s: Session | null): void;
    hasSession(): boolean;
  }
  createApiClient(o: { baseUrl: string; fetch?: typeof fetch; onSessionLost: () => void }): ApiClient;
  ```

  Behaviour per decision 5. Network failure → `ApiError('network')`. `429` fills `retryAfterS` from `Retry-After`.

- `endpoints.ts`: one function per endpoint used in M4, typed by the shared schemas, e.g. `login(api, body: z.input<typeof loginBodySchema>): Promise<Session>`, `getDevices(api)`, `getDevice(api, id)`, `getOutages(api, id, cursor?)`, `patchDevice(api, id, body)`, `createDevice`, `newPairingCode`, `rotateToken`, `deleteDevice`, `getChannels`, `createTelegramLink`, `deleteChannel`, `getDeviceChannels`, `putDeviceChannels`, `getMe`, `patchMe`, `deleteMe`, `signup`, `verifyEmail`, `resendVerification`, `forgotPassword`, `resetPassword`, `changePassword`, `logout`, `logoutAll`, `unlinkGoogle`.
- `queries.ts`: `queryKeys = { me: ['me'], devices: ['devices'], device: (id) => ['device', id], outages: (id) => ['outages', id], channels: ['channels'], deviceChannels: (id) => ['deviceChannels', id] }` and hooks `useMe`, `useDevices`, `useDevice`, `useOutages` (infinite), `useChannels`, `useDeviceChannels` with the decision 9 intervals.
- `session.tsx`: `SessionProvider`, `useSession(): { status: 'loading' | 'anonymous' | 'authenticated'; me: Me | null; signedIn(s: Session): void; signOut(): Promise<void>; api: ApiClient }`. `signedIn` stores the session and seeds `queryKeys.me`. `signOut` calls `logout`, clears the query cache and sets `anonymous`. `onSessionLost` → `anonymous` and `navigate('/login?next=…')` once. `RequireAuth` (route element) shows a skeleton while loading and redirects anonymous users with `next`. `RequireAnon` sends signed-in users to `/devices`.
- `safeNext(raw: string | null): string` per decision 6.
- `fixtures.ts`: `meFixture(overrides?)`, `deviceFixture(overrides?)`, `outageFixture(overrides?)`, `channelFixture(overrides?)`, `sessionFixture(overrides?)`, each typed with the shared types.

- [ ] **Step 1: Tests (`client.test.ts`, MSW):**
  - `request` adds `Authorization: Bearer <token>` after `setSession`; `/api/auth/refresh` is sent with credentials and no bearer.
  - A response that fails the schema → `ApiError` `invalid_response`; extra keys are stripped.
  - `401` on `GET /api/v1/devices` → one refresh → retried with the new token → resolves.
  - Review Focus 2: four parallel requests all get `401` once → `refresh` handler called exactly 1 time, all four resolve.
  - Refresh `401` → `onSessionLost` called once, the requests reject with `unauthorized`.
  - Review Focus 1: refresh `409` then `200` → resolves with the session; two `409`s → `null` and no further call.
  - `POST /api/auth/login` answering `401 invalid_credentials` → no refresh call.
  - `429` with `Retry-After: 30` → `retryAfterS === 30`. Fetch throws → `network`.
- [ ] **Step 2: Tests (`session.test.tsx`):**
  - On load the provider calls refresh once even under `StrictMode`; `200` → `authenticated` with `me`; `401` → `anonymous`.
  - `renderRoute('/devices')` anonymous → lands on `/login?next=%2Fdevices`.
  - `safeNext`: `'/devices/abc'` kept; `'//evil.example'`, `'/\\evil'`, `'https://evil.example'`, `null`, `''` → `/devices`.
- [ ] **Step 3:** Run → FAIL, implement, → PASS.
- [ ] **Commit point:** `client/` — `Add API client and session handling`

### Task 6: Auth pages

**Files:**

- Create: `client/src/forms/zodErrors.ts`, `client/src/forms/zodErrors.test.ts`, `client/src/pages/auth/{AuthLayout,LoginPage,SignupPage,VerifyEmailPage,ForgotPasswordPage,ResetPasswordPage,GoogleCallbackPage,GoogleButton}.tsx`, `client/src/pages/auth/*.test.tsx`, `client/src/lib/google.ts`
- Modify: `client/src/app/router.tsx`, `shared/src/i18n/locales/{uk,en,ru}.ts` (`app.auth.*`, `app.validation.*`, `app.google.errors.*`)
- Docs: `docs/PROJECT_V2.md` §9 Localization (decision 7), §3 Google sign-in (decision 11, client side)

**Interfaces:**

- `zodErrors.ts`: `translateIssue(issue: z.core.$ZodIssue, t: TFunction): string`. Keys: `too_small` / `too_big` → `app.validation.too_small_string` ("At least {{min}} characters") or `too_small_number` ("At least {{min}}"), same for `too_big` with `{{max}}`; `invalid_format` with `format: 'email'` → `app.validation.email`; `custom` with `params.reason` → `app.validation.<reason>` (`same_time`, `password_mismatch`); anything else → `app.validation.invalid`. `installZodErrors(i18n)` sets `z.config({ customError })` once at startup. `applyServerErrors(error: ApiError, setError, fields: readonly string[]): boolean` maps `details[].path` onto known fields (`settings.` prefix stripped), translates `too_small` / `too_big` details with the `_number` keys and others with `app.validation.<code>` falling back to `invalid`, and returns `false` if any detail had no field (the caller then shows a form error).
- `google.ts`: `startGoogle(intent: GoogleIntent, next?: string): void`, `takeGoogleState(): { intent: GoogleIntent; next: string } | null` (decision 11).
- Routes: `/login`, `/signup`, `/forgot-password`, `/verify-email?token`, `/reset-password?token`, `/auth/google`. `/login`, `/signup`, `/forgot-password` are `RequireAnon`.
- Behaviour:
  - Login: success → `signedIn` → `safeNext(next)`. `invalid_credentials` → form error. `rate_limited` → error with the wait.
  - Sign up: `201` → "Check your email" screen (no sign-in, P §3).
  - Verify email: posts the token once on mount; `204` → success with "Go to devices" (or "Log in"); `410` → "Link expired" with resend (signed in) or log in.
  - Forgot → always the same "If an account exists…" screen.
  - Reset: `204` → "Password changed, log in" (all sessions were revoked); `410` → expired with link to forgot password.

- [ ] **Step 1: Tests:**
  - `translateIssue` for `passwordSchema.safeParse('short')` in en → `'At least 8 characters'`; email invalid → `app.validation.email` text; quiet hours same time → `app.validation.same_time` text.
  - Login form: submit empty → both fields show errors and no request is sent; wrong password (MSW `401`) → form error text; success → `/devices`.
  - Review Focus 3: `renderRoute('/login?next=%2Fdevices%2Fd1')`, log in → path `/devices/d1`; with `next=%2F%2Fevil.example` → `/devices`.
  - Sign up: password of 7 chars → inline error, no request; valid → request body has `language: 'en'` and the browser timezone; the "check your email" screen shows.
  - Verify page with `?token=x`: MSW `410` → expired text; `204` → success text. Only one request even under `StrictMode`.
  - Google callback `?error=google_account_in_use` → translated text; no error and stored `{ intent: 'LINK' }` → refresh then `/account`.
- [ ] **Step 2:** Run → FAIL, write uk / ru copy, implement, → PASS.
- [ ] **Step 3: Docs** per the Files list.
- [ ] **Commit point:** `client/ shared/src/i18n/ docs/PROJECT_V2.md` — `Add sign-in, sign-up and password pages`

### Task 7: Layout and devices list

**Files:**

- Create: `client/src/app/Layout.tsx`, `client/src/app/VerifyBanner.tsx`, `client/src/components/StatusBadge.tsx`, `client/src/lib/format.ts`, `client/src/pages/devices/DevicesPage.tsx`, `client/src/pages/devices/DevicesPage.test.tsx`, `client/src/app/VerifyBanner.test.tsx`
- Modify: `client/src/app/router.tsx`, locales (`app.nav.*`, `app.devices.*`, `app.state.*`, `app.verify.*`)

**Interfaces:**

- `lib/format.ts`: `useFormatters(): { moment(iso: string): string; duration(seconds: number): string; range(fromIso: string, toIso: string): string; since(iso: string, now?: Date): string }` from the shared formatters with `/me` language and timezone (decision 8).
- `StatusBadge({ state }: { state: DeviceState })`: 🟢 `ONLINE` `--status-online`, 🔴 `OFFLINE` `--status-offline`, ⚪ `PENDING` / `UPDATING` `--status-pending`, with a translated label (not color only).
- Layout: header with Devices, Notifications, Account, language switcher, link "API docs" → `${apiUrl()}/api/docs`; `VerifyBanner` when `!me.email_verified` (decision 10); `<Outlet />`. `/` → `/devices`. All signed-in routes sit under `RequireAuth` + `Layout`.
- Devices page: a card per device: name, badge, "since", last seen (or "Never" for `PENDING`), "Shared" badge when `role === 'VIEWER'`; card links to `/devices/:id`. Empty state with "Add device". "Add device" button disabled with hint when unverified.

- [ ] **Step 1: Tests:**
  - Two devices (`ONLINE` with `state_since` `2026-11-21T16:42:00Z`, and `OFFLINE`) at fake time `2026-11-21T18:42:00Z`, `me.timezone` `Europe/Kyiv` → names, translated state labels and `since 21 Nov 18:42`.
  - Viewer device shows "Shared". Empty list shows the empty state.
  - The list refetches after 30 s (fake timers): the second response's state is shown.
  - Unverified `me` → banner; **Resend email** posts `resend-verification` and shows the toast; `429` with `Retry-After: 120` shows the wait. Add device is disabled.
- [ ] **Step 2:** Run → FAIL, implement, → PASS.
- [ ] **Commit point:** `client/ shared/src/i18n/` — `Add layout and devices list`

### Task 8: Add-device wizard

**Files:**

- Create: `client/src/pages/devices/AddDevicePage.tsx`, `client/src/pages/devices/AddDevicePage.test.tsx`, `client/src/components/PairingCode.tsx`
- Modify: `client/src/app/router.tsx` (`/devices/new`), locales (`app.addDevice.*`)

**Interfaces:**

- Steps: (1) name form (`deviceNameSchema`) → `POST /devices`; (2) `PairingCode` shows the code in groups of 4, a copy button, the countdown to `pairing_code_expires_at`, and the setup instructions (P §4 Adding a device; the flash step is a note that M5 adds the "Flash firmware" page); (3) waits: polls `GET /devices/:id` every 3 s while `PENDING`; (4) done: 🟢 and a link to the device page.
- `PairingCode({ code, expiresAt, onRenew }: { code: string; expiresAt: string; onRenew: () => void })`, reused by re-pair in Task 10. When expired it hides the code and shows **Get a new code**, which calls `POST /devices/:id/pairing-code`.
- `409 conflict` on create (20-device cap) → translated "You can have up to 20 devices".

- [ ] **Step 1: Tests:**
  - Empty name → inline error, no request. 65 chars → error.
  - Create → code `K7Q2 M9XD` shown; after 3 s the device is still `PENDING` → still waiting; next poll returns `ONLINE` → done step, and no further `GET` after 10 more seconds.
  - Review Focus 4: advance past `pairing_code_expires_at` → polling stops (no `GET` in the next 10 s), **Get a new code** → new code shown and polling resumes.
  - `409` on create → the cap message.
- [ ] **Step 2:** Run → FAIL, implement, → PASS.
- [ ] **Commit point:** `client/ shared/src/i18n/` — `Add device setup wizard`

### Task 9: Device page — status and outage timeline

**Files:**

- Create: `client/src/pages/devices/DevicePage.tsx`, `client/src/pages/devices/OutageTimeline.tsx`, `client/src/pages/devices/DevicePage.test.tsx`, `client/src/pages/devices/OutageTimeline.test.tsx`
- Modify: `client/src/app/router.tsx` (`/devices/:id`), locales (`app.device.*`, `app.outage.*`)

**Interfaces:**

- Device page header: name, `StatusBadge`, since, last seen, RSSI and uptime from `telemetry` when present, open outage ("Offline since …"). Sections below in order: Timeline, Notifications (Task 11), Settings and Danger zone (Task 10).
- `404 not_found` → "Device not found" with a link back to the list.
- `OutageTimeline({ deviceId })`: `useOutages` (`limit` 20, newest first), **Show more** while `next_cursor`. Item: type icon (outage / power blip), `range` or "ongoing since …", `duration`, cause label (`POWER` / `NETWORK` / `UNKNOWN`) and kind (`SHORT` / `LONG`). Open outage in `--status-offline`, power blips in `--warning`. Empty state.

- [ ] **Step 1: Tests:**
  - `ONLINE` device with RSSI −61 → badge, since, `-61 dBm`.
  - `OFFLINE` device with an open outage started `2026-11-21T16:42:00Z` (Kyiv) → "Offline since 21 Nov 18:42".
  - Unknown ID (MSW `404`) → not-found text.
  - Timeline: first page of 20 plus `next_cursor` → **Show more** fetches with `cursor` and appends; last page hides the button. An item `16:42Z → 18:57Z`, 8100 s, `POWER`, `LONG` → `18:42 → 20:57`, `2 h 15 min`, `Power outage`, `Long`. Open outage → "ongoing".
- [ ] **Step 2:** Run → FAIL, implement, → PASS.
- [ ] **Commit point:** `client/ shared/src/i18n/` — `Add device page and outage timeline`

### Task 10: Device settings and owner actions

**Files:**

- Create: `client/src/pages/devices/DeviceSettingsForm.tsx`, `client/src/pages/devices/DeviceDangerZone.tsx`, `client/src/pages/devices/DeviceSettingsForm.test.tsx`, `client/src/pages/devices/DeviceDangerZone.test.tsx`, `client/src/components/ConfirmDialog.tsx`
- Modify: `client/src/pages/devices/DevicePage.tsx`, locales (`app.settings.*`, `app.danger.*`)
- Docs: `docs/PROJECT_V2.md` §9 (decisions 12, 13)

**Interfaces:**

- `deviceSettingsFormSchema` (client, in the form file): name, ping interval s, offline timeout s, short threshold **minutes**, two notify switches, quiet hours enabled + start + end; `superRefine` adds `{ path: ['offline_timeout_s'], code: 'too_small', minimum: 2 × ping }`. Submit sends only changed fields as `devicePatchSchema` input. On `200` the device query is updated from the response.
- Owner only (decision 13). Shows `settings_sync.pending` per decision 12.
- `ConfirmDialog({ title, body, confirmLabel, destructive?, onConfirm })` on shadcn `alert-dialog`.
- Danger zone: **Re-pair** → `POST pairing-code` → dialog with `PairingCode`; **Rotate token** → confirm ("The device stops checking in until you pair it again") → `204` → toast; **Delete** → confirm → `204` → invalidate `devices`, navigate `/devices`.

- [ ] **Step 1: Tests:**
  - Review Focus 5: ping 60, timeout 100 → inline `At least 120` on timeout, no request.
  - Server `400` with detail `{ path: 'settings.short_outage_threshold_s', code: 'too_big', max: 86400 }` → error on the threshold field; detail with path `settings.unknown` → form-level error.
  - Changing only the threshold to 5 min sends `{ settings: { short_outage_threshold_s: 300 } }` and nothing else.
  - Quiet hours on, `23:00`–`23:00` → `same_time` error.
  - `settings_sync.pending: true` → "Waiting for the device to apply".
  - Viewer (`role: 'VIEWER'`) → no settings form and no danger zone.
  - Delete → confirm → `DELETE` sent → path `/devices`. Cancel → no request.
  - Re-pair shows the new code.
- [ ] **Step 2:** Run → FAIL, implement, → PASS.
- [ ] **Step 3: Docs** per the Files list.
- [ ] **Commit point:** `client/ shared/src/i18n/ docs/PROJECT_V2.md` — `Add device settings and owner actions`

### Task 11: Telegram connection and per-device channels

**Files:**

- Create: `client/src/pages/notifications/NotificationsPage.tsx`, `client/src/pages/notifications/TelegramConnect.tsx`, `client/src/pages/devices/DeviceChannels.tsx`, `client/src/pages/notifications/NotificationsPage.test.tsx`, `client/src/pages/devices/DeviceChannels.test.tsx`
- Modify: `client/src/app/router.tsx` (`/notifications`), `client/src/pages/devices/DevicePage.tsx`, locales (`app.notifications.*`, `app.channel.*`)

**Interfaces:**

- Notifications page: channel list (name, type label, enabled, `disabled_reason` badge) with **Remove** (confirm → `DELETE /channels/:id`). `TelegramConnect`: **Connect Telegram** → `POST /channels/telegram-link` → **Open in Telegram** (`url`) and **Add to a group** (`group_url`) as links with `target="_blank" rel="noopener"`, the countdown, and polling per decision 9. A channel ID not in the list from before the link → success toast, the panel closes. Expiry → "Link expired, create a new one". Unverified → disabled with hint. `429` → the wait.
- `DeviceChannels({ deviceId })`: a checkbox per own channel, preselected from `GET /devices/:id/channels`, **Save** → `PUT` with `channel_ids`; empty channel list → a link to `/notifications`.

- [ ] **Step 1: Tests:**
  - Connect → both links have the right `href`; polling: first `GET /channels` unchanged, second has a new channel → success text and no further polling.
  - Expiry (fake time past `expires_at`) → expired text, polling stopped.
  - Remove → confirm → `DELETE /api/v1/channels/c1` → the channel disappears.
  - Device channels: two channels, one linked → one box checked; check the other and save → `PUT` body `{ channel_ids: ['c1', 'c2'] }`. No channels → link to `/notifications`.
- [ ] **Step 2:** Run → FAIL, implement, → PASS.
- [ ] **Commit point:** `client/ shared/src/i18n/` — `Add Telegram connection and device channels`

### Task 12: Account page

**Files:**

- Create: `client/src/pages/account/{AccountPage,ProfileForm,SignInMethods,ChangePasswordForm,SessionsCard,DeleteAccount}.tsx`, `client/src/pages/account/*.test.tsx`, `client/src/components/TimezoneSelect.tsx`
- Modify: `client/src/app/router.tsx` (`/account`), `client/src/components/LanguageSwitcher.tsx` (signed in → `PATCH /me`), locales (`app.account.*`)

**Interfaces:**

- Profile: name (`nameSchema`), language (switches the UI after `200`), timezone (`TimezoneSelect`: searchable list from `Intl.supportedValuesOf('timeZone')`), theme (`useTheme`, local only). Saves with `PATCH /me` (`mePatchSchema`), updates `queryKeys.me`.
- Sign-in methods: Google linked → **Unlink** (`DELETE /api/auth/google`; `409` → "Add a password first: use Forgot password"); not linked → **Link Google** (`startGoogle('LINK')`).
- Change password (only when `has_password`): current, new, repeat (client-side match check). `204` → toast ("Other sessions were signed out"). `403 invalid_credentials` → error on current.
- Sessions: **Log out** (`signOut`) and **Log out everywhere** (`logout-all`, then local sign-out and `/login`).
- Delete account: dialog. With a password → password field → `DELETE /me { password }`. Google-only → no field; `403 reauth_required` → **Sign in with Google again** (decision 11). `?confirmDelete=1` opens the dialog. `204` → clear the session and go to `/login` with a toast.

- [ ] **Step 1: Tests:**
  - Profile: change language to `uk` → `PATCH` body `{ language: 'uk' }` and the page heading switches to the uk text.
  - Name empty → inline error. Timezone search `kyiv` → `Europe/Kyiv` selectable.
  - Unlink `409` → the "add a password first" text. Link Google stores `{ intent: 'LINK', next: '/account' }` and calls `location.assign` with `…/api/auth/google?app=CLIENT&intent=LINK`.
  - Change password: mismatch → inline error, no request; `403` → error on the current field.
  - Delete with wrong password (`403 invalid_credentials`) → error, still signed in. Google-only `reauth_required` → the re-sign-in button. `/account?confirmDelete=1` → dialog open. `204` → `/login`.
  - Log out everywhere → `logout-all` sent, then `/login`.
- [ ] **Step 2:** Run → FAIL, implement, → PASS.
- [ ] **Commit point:** `client/ shared/src/i18n/` — `Add account page`

### Task 13: Vercel, docs and roadmap

**Files:**

- Create: `client/vercel.json`
- Modify: `deploy/README.md` (new section "Client app on Vercel"), `docs/PROJECT_V2.md` §9 (theme pointer, polling), §12 (Vercel settings, `VITE_API_URL` in Config), `CLAUDE.md` (docs list: `theme.md` is the source of truth for app colors), `docs/ROADMAP.md`

**Interfaces:**

- `client/vercel.json`: `{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }`.
- `deploy/README.md` section lists the manual Vercel steps (decision 15): import the repo, Root Directory `client`, framework Vite, build `npm run build`, output `dist`, include files outside the root (for `shared/`), Node version 26 (if Vercel has no Node 26 yet, the latest it offers and note it), `VITE_API_URL=https://staging-api.elec-monitoring.homes` for Preview, the `v2` branch domain `staging-app.elec-monitoring.homes`, and the Porkbun `CNAME` it asks for.

- [ ] **Step 1:** `npm ci && npm run lint && npm run fmt:check && npm run typecheck && npm run build && npm test` → exit 0.
- [ ] **Step 2: Roadmap:** tick the merged M4 deliverables, link this plan in the status board, M4 🟡 until the manual checks pass.
- [ ] **Commit point:** `client/vercel.json deploy/README.md docs/ CLAUDE.md` — `Add Vercel config and M4 docs`

**M4 done when (ROADMAP):** component tests cover form validation (Tasks 6, 8, 10, 12) and token refresh (Task 5).

Set up by hand (outward-facing, not done by the agent): the Vercel project and its env var, the `staging-app` domain and its DNS record. The staging API already has `CLIENT_URL=https://staging-app.elec-monitoring.homes`.

Verify by hand on `https://staging-app.elec-monitoring.homes`:

- Sign up, open the verify link from the email, log in; reload the page and stay signed in.
- Log in with Google; link and unlink Google from Account.
- Forgot password → reset link → log in with the new password.
- Add a device with the fake device (`npm run fake-device`), watch the wizard turn 🟢; stop the fake device and see 🔴 and the open outage; start it and see the timeline entry.
- Change settings, re-pair, rotate token (fake device gets `401`), delete.
- Connect Telegram (private chat and a group), choose channels on the device page, remove a channel.
- Account: change name, language (UI switches), timezone (times shift), theme, change password, log out everywhere, delete the account.
- Reload a deep link (`/devices/<id>`, `/account`) signed in and signed out.
- Leave a tab idle for over 15 min, then click around: no sign-out.
- Light, dark and system themes on a phone-sized screen.
