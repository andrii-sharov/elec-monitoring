# M0 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a deployable, empty API and worker with the full schema, CI and the
shared building blocks (config, clock, crypto, i18n, errors, OpenAPI) every
later milestone uses.

**Architecture:** npm workspaces `shared/` (enums, translations) and
`server/` (one codebase, two entry points: `src/api.ts`, `src/worker.ts`).
Every runtime dependency (db, clock, logger, config) is injected through
factories, so tests build an app or worker around a PGlite database and a
fake clock with no network.

**Tech Stack:** Node.js 26, Express 5, TypeScript 7 (`tsc`), `tsx`,
Vitest 5, Drizzle ORM 0.45 + Drizzle Kit 0.31, postgres.js 4, PGlite 0.5,
Zod 4, zod-openapi 6, swagger-ui-express 5, i18next 27.

**Spec:** [ROADMAP.md § M0](../ROADMAP.md#m0--foundation),
[PROJECT_V2.md](../PROJECT_V2.md) §2 Architecture, §9 Localization, §10, §12,
§13 · [DATABASE.md](../DATABASE.md) (all of it) · [API.md](../API.md) §1, §7.

## Global Constraints

- ESM everywhere (`"type": "module"`), `module`/`moduleResolution: nodenext`, `strict: true`.
- `engines.node: ">=26"`; CI uses Node 26.
- Database names `snake_case`; Drizzle `casing: "snake_case"`; users table is `app_user`.
- IDs: UUIDv7 generated in the server (Q1). Node 26 has `crypto.randomUUIDv7()`; no `uuid` package.
- Timestamps `timestamptz`; durations integer seconds, `_s` suffix.
- postgres.js with `prepare: false` (Supabase transaction pooler, D §9).
- RLS enabled on every table, **no policies**, no `force row level security` (D §10).
- Errors: `{ "error": { "code", "message", "details"? } }`; `message` is English (A §1).
- Languages `uk`, `en`, `ru`; default and fallback `uk` (P §9).
- No comments unless the logic is truly non-obvious. No real names in code, tests or docs.
- Commits are made by the user. Each "Commit point" lists files and a message (≤ 50 chars, imperative).

## Decisions made in this plan

Record these in the spec in Task 10.

1. **Config grows per milestone.** M0 validates only the keys M0 code reads:
   `DATABASE_URL`, `PORT` (default `3000`). Each milestone adds its keys to
   the schema when its code first reads them, so the empty API can deploy
   without Google, Resend or Telegram secrets. Add `PORT` to P §12 Config.
2. **`/health` when the DB is down:** `503 {"status":"unavailable"}`.
   Ping has a 3 s timeout. Add to A §7.
3. **App dependencies in M0:** `{ db, clock, logger, config }`. Email and
   Telegram senders join `AppDeps` in M1 / M3, when they exist (the roadmap
   lists "senders"; there is nothing to inject yet).
4. **Privilege revoke** is a separate custom migration (`0001`) right after
   the generated `0000`, so regenerating `0000` never drops it. Both ship in
   the first deploy. It is guarded with `if exists (select from pg_roles …)`
   because PGlite and plain Postgres have no `anon` / `authenticated` roles.
5. **`shared/` is built with `tsc` to `dist/`.** Its `exports` add a
   `"source"` condition pointing at `src/`, used by Vitest, `tsx` and the
   server type check (`customConditions`), so dev and tests never need a
   prior build of `shared/`.
6. **Body-parser errors** (malformed JSON, too large, bad charset) map to
   `400 validation_error` with no `details`, since A §1 has no other 4xx for them.
7. **`updated_at`** uses Drizzle `$onUpdate(() => new Date())`, not the
   injected clock. It's audit data, never used in time-based logic.
8. **Time-based logic passes `clock.now()` explicitly** into queries. Column
   `default now()` stays only as a safety net for inserts that omit the value.

## Review Focus

1. **Malformed JSON body** (`{"a":`) with `Content-Type: application/json` → `400` with the A §1 error shape, not Express's HTML page. Test in Task 7.
2. **Unknown path or method** (`GET /nope`, `DELETE /health`) → `404 {"error":{"code":"not_found",…}}` JSON. Test in Task 7.
3. **Unexpected exception** in a route → `500 internal` with message `"Internal error"`; the original message and stack never reach the response, and they are logged. Test in Task 7.
4. **Database unreachable or hanging** → `/health` returns `503` within the timeout, the process keeps running. Test in Task 7.
5. **Worker tick throws** (DB blip) → error logged, loop keeps running; SIGTERM during a tick waits for the tick to finish, then exits cleanly. Tests in Task 9.

---

## File structure

```
package.json                     root: workspaces, lint/fmt/typecheck/build/test scripts
tsconfig.base.json               shared compiler options
.github/workflows/ci.yml
shared/
  package.json  tsconfig.json
  src/index.ts                   re-exports
  src/enums.ts                   enum value lists (DB native enums, languages)
  src/i18n/index.ts              resources, languages, defaultLanguage
  src/i18n/locales/{uk,en,ru}.ts
  src/i18n/parity.test.ts
server/
  package.json  tsconfig.json  tsconfig.build.json  vitest.config.ts  drizzle.config.ts
  .env.example
  drizzle/                       generated SQL migrations + meta
  src/api.ts                     API entry (start:api)
  src/worker.ts                  worker entry (start:worker)
  src/config.ts
  src/clock.ts
  src/lib/crypto.ts              newId, randomToken, sha256, encrypt, decrypt
  src/i18n.ts                    server i18next instance
  src/db/client.ts               Db type, createDb (postgres.js)
  src/db/migrate.ts              db:migrate script
  src/db/types.ts                bytea, tstz column helpers
  src/db/schema/{index,enums,auth,devices,firmware,monitoring,notifications,platform}.ts
  src/http/app.ts                createApp
  src/http/errors.ts             HttpError, notFound, errorHandler
  src/http/health.ts
  src/http/openapi.ts            buildOpenApiDocument, docs router
  src/worker/loop.ts             runLoop
  src/worker/heartbeat.ts        beat
  test/db.ts                     createTestDb (PGlite), createPgTestDb (real Postgres)
  test/fakes.ts                  FakeClock, silentLogger
```

Tests sit next to the code as `*.test.ts`. Tests that need a real Postgres
are named `*.pg.test.ts`.

---

### Task 1: Workspaces and toolchain

**Files:**

- Modify: `package.json`, `.gitignore`
- Create: `tsconfig.base.json`, `shared/package.json`, `shared/tsconfig.json`, `shared/src/index.ts`, `server/package.json`, `server/tsconfig.json`, `server/tsconfig.build.json`, `server/vitest.config.ts`, `server/.env.example`, `server/src/smoke.test.ts` (deleted in Task 3)

**Interfaces:**

- Produces root scripts: `lint`, `fmt`, `fmt:check` (exist), `typecheck`, `build`, `test` — all run across both workspaces, `shared` first.
- Produces server scripts: `dev:api`, `dev:worker`, `start:api`, `start:worker`, `build`, `typecheck`, `test`, `db:generate`, `db:migrate`.

- [ ] **Step 1: Root setup.** `"workspaces": ["shared", "server"]`, `"engines": {"node": ">=26"}`. Scripts: `typecheck` = `npm run typecheck --workspaces`, `build` = `npm run build -w shared -w server`, `test` = `npm run test --workspaces`. `tsconfig.base.json`: `target es2024`, `module nodenext`, `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `skipLibCheck`, `declaration`, `sourceMap`.
- [ ] **Step 2: `shared/`.** Package `@elec/shared`, `exports["."]`: `{ "source": "./src/index.ts", "types": "./dist/index.d.ts", "default": "./dist/index.js" }`. Scripts `build` (`tsc`), `typecheck` (`tsc --noEmit`), `test` (`vitest run`). Dev deps: `typescript`, `vitest`.
- [ ] **Step 3: `server/`.** Package `@elec/server`, depends on `@elec/shared` (`"*"`). Install runtime deps: `express`, `drizzle-orm`, `postgres`, `zod`, `zod-openapi`, `swagger-ui-express`, `i18next`; dev deps: `typescript`, `tsx`, `vitest`, `drizzle-kit`, `@electric-sql/pglite`, `@types/express`, `@types/swagger-ui-express`, `@types/node`, `supertest`, `@types/supertest`. `tsconfig.json` sets `customConditions: ["source"]` and includes `src`, `test`; `tsconfig.build.json` extends it, `outDir dist`, excludes `**/*.test.ts` and `test/`. Scripts: `dev:api` = `tsx watch --conditions=source --env-file-if-exists=.env src/api.ts` (same for worker), `start:api` = `node dist/api.js`, `start:worker` = `node dist/worker.js`, `build` = `tsc -p tsconfig.build.json`, `typecheck` = `tsc --noEmit`, `test` = `vitest run`. `vitest.config.ts`: `resolve.conditions: ['source']`, `test.environment 'node'`.
- [ ] **Step 4: `server/.env.example`** with `DATABASE_URL=postgres://postgres:postgres@localhost:5432/elec` and `PORT=3000`. `.gitignore`: keep `.env`, add `*.tsbuildinfo`.
- [ ] **Step 5: Smoke test** `server/src/smoke.test.ts`: `expect(1 + 1).toBe(2)`.
- [ ] **Step 6: Verify.** `npm install && npm run lint && npm run fmt:check && npm run typecheck && npm run build && npm test` — all exit 0, smoke test passes.
- [ ] **Commit point:** `package.json package-lock.json .gitignore tsconfig.base.json shared/ server/package.json server/tsconfig*.json server/vitest.config.ts server/.env.example server/src/smoke.test.ts` — `Set up shared and server workspaces`

### Task 2: Env config

**Files:**

- Create: `server/src/config.ts`, `server/src/config.test.ts`

**Interfaces:**

- Produces: `type Config = { databaseUrl: string; port: number }`; `loadConfig(env: NodeJS.ProcessEnv): Config`; `class ConfigError extends Error { readonly keys: string[] }`.

- [ ] **Step 1: Tests**

```ts
test('loads valid env', () => {
  expect(loadConfig({ DATABASE_URL: 'postgres://u:p@h:5432/db', PORT: '8080' })).toEqual({
    databaseUrl: 'postgres://u:p@h:5432/db',
    port: 8080,
  });
});
test('PORT defaults to 3000', () => {
  expect(loadConfig({ DATABASE_URL: 'postgres://h/db' }).port).toBe(3000);
});
test('lists every invalid key without printing values', () => {
  const err = catchError(() => loadConfig({ PORT: 'abc', DATABASE_URL: 'not a url' }));
  expect(err).toBeInstanceOf(ConfigError);
  expect(err.keys).toEqual(['DATABASE_URL', 'PORT']);
  expect(err.message).not.toContain('not a url');
});
test('missing DATABASE_URL fails', () => {
  expect(() => loadConfig({})).toThrow(ConfigError);
});
```

- [ ] **Step 2: Run** `npm test -w server -- config` → FAIL (module missing).
- [ ] **Step 3: Implement** with a Zod object over the env (`DATABASE_URL: z.url()` with `postgres:`/`postgresql:` protocol, `PORT: z.coerce.number().int().min(1).max(65535).default(3000)`), collect `issue.path[0]` keys sorted, message `Invalid environment: DATABASE_URL, PORT`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Commit point:** `server/src/config.ts server/src/config.test.ts` — `Add Zod env config`

### Task 3: Clock and crypto helpers

**Files:**

- Create: `server/src/clock.ts`, `server/src/logger.ts`, `server/src/lib/crypto.ts`, `server/src/lib/crypto.test.ts`, `server/test/fakes.ts`, `server/test/fakes.test.ts`
- Delete: `server/src/smoke.test.ts`

**Interfaces:**

- Produces: `interface Clock { now(): Date }`, `systemClock: Clock`.
- Produces (test): `class FakeClock implements Clock { constructor(start: Date); set(d: Date): void; advance(ms: number): void }`; `silentLogger: Logger`.
- Produces: `type Logger = Pick<Console, 'info' | 'warn' | 'error'>` in `server/src/logger.ts`.
- Produces: `newId(): string`, `randomToken(): string` (base64url of 32 random bytes, 43 chars), `sha256(input: string | Buffer): Buffer`, `encrypt(key: Buffer, plaintext: string): Buffer`, `decrypt(key: Buffer, blob: Buffer): string`.

- [ ] **Step 1: Tests** in `crypto.test.ts`:
  - `newId` matches `/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/`, and the first 48 bits decode to a time within 1 s of `Date.now()`.
  - `randomToken()` is 43 chars of `[A-Za-z0-9_-]`, decodes to 32 bytes, two calls differ.
  - `sha256('abc').toString('hex') === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'`; result length 32.
  - `decrypt(key, encrypt(key, 'secret ✓'))` round-trips; blob length = 12 + byte length + 16; two encryptions of the same text differ.
  - Flipping any byte (nonce, ciphertext, tag) makes `decrypt` throw; a different key throws; a 16-byte key throws; a blob shorter than 28 bytes throws.

  In `fakes.test.ts`: `FakeClock` returns the start time, `advance(1000)` moves 1 s, `now()` returns a copy (mutating it doesn't move the clock).

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** `newId` = `crypto.randomUUIDv7()`. AES-256-GCM via `node:crypto` `createCipheriv('aes-256-gcm', key, nonce)`, 12-byte random nonce, 16-byte tag, layout `nonce || ciphertext || tag` (D §1). Reject keys that aren't 32 bytes with a plain `Error`.
- [ ] **Step 4: Run** → PASS. Delete the smoke test.
- [ ] **Commit point:** `server/src/clock.ts server/src/logger.ts server/src/lib/ server/test/fakes.ts server/test/fakes.test.ts server/src/smoke.test.ts` — `Add clock and crypto helpers`

### Task 4: Shared enums and i18n

**Files:**

- Create: `shared/src/enums.ts`, `shared/src/i18n/index.ts`, `shared/src/i18n/locales/{uk,en,ru}.ts`, `shared/src/i18n/parity.test.ts`, `server/src/i18n.ts`, `server/src/i18n.test.ts`
- Modify: `shared/src/index.ts`

**Interfaces:**

- Produces (`@elec/shared`), each `as const` tuple plus a union type of the same name in PascalCase:
  `deviceStates = ['PENDING','ONLINE','OFFLINE','UPDATING']`,
  `resetReasons = ['POWER_ON','BROWNOUT','SOFTWARE','WATCHDOG','PANIC','UNKNOWN']`,
  `diagnosticKinds = ['WIFI','API']`, `outageTypes = ['OUTAGE','POWER_BLIP']`,
  `outageCauses = ['POWER','NETWORK','UNKNOWN']`, `outageKinds = ['SHORT','LONG']`,
  `updateOutcomes = ['SUCCEEDED','FAILED','ROLLED_BACK']`,
  `languages = ['uk','en','ru']`, `defaultLanguage: Language = 'uk'`.
- Produces: `resources: Record<Language, { translation: Dictionary }>` where `Dictionary` is the type of `en` (nested string records).
- Produces (server): `createI18n(): i18n` — a fresh i18next instance, initialised synchronously.

- [ ] **Step 1: Seed dictionaries.** One namespace `translation`. Seed keys used to prove the setup: `common.appName` and `common.greeting` = `"Hello, {{name}}"` (and the uk / ru translations). Later milestones add real keys.
- [ ] **Step 2: Parity test** (`parity.test.ts`):
  - flattened dot-path key sets of `uk` and `ru` equal `en`'s (report missing and extra keys per language in the failure message);
  - no value is an empty string;
  - each key's set of `{{placeholders}}` is the same in all three languages.
- [ ] **Step 3: Server i18n test:** `t('common.greeting', { lng: 'en', name: 'John' }) === 'Hello, John'`; `lng: 'ru'` returns the Russian text; `lng: 'de'` falls back to the `uk` text; a missing key returns the key.
- [ ] **Step 4: Run** `npm test` → FAIL, then implement: `i18next.createInstance()`, `init({ resources, fallbackLng: 'uk', supportedLngs: languages, initAsync: false, interpolation: { escapeValue: false } })`.
- [ ] **Step 5: Run** → PASS. Break parity on purpose (delete a `ru` key) once, confirm the test names the key, restore.
- [ ] **Commit point:** `shared/src/ server/src/i18n.ts server/src/i18n.test.ts` — `Add shared enums and i18n dictionaries`

### Task 5: Drizzle schema, migrations and PGlite harness

**Files:**

- Create: `server/drizzle.config.ts`, `server/src/db/types.ts`, `server/src/db/schema/*.ts`, `server/src/db/client.ts`, `server/src/db/migrate.ts`, `server/drizzle/0000_*.sql`, `server/drizzle/0001_revoke_public_roles.sql`, `server/drizzle/meta/*`, `server/test/db.ts`, `server/src/db/schema.test.ts`

**Interfaces:**

- Consumes: enum tuples from `@elec/shared`; `newId` from Task 3.
- Produces: `schema` (namespace export of all tables); `type Db = PgDatabase<PgQueryResultHKT, typeof schema>`; `createDb(url: string): { db: Db; close(): Promise<void> }` (postgres.js, `prepare: false`, `connect_timeout: 5`, `max: 10`); `migrationsFolder: string` (absolute path to `server/drizzle`).
- Produces (test): `createTestDb(): Promise<{ db: Db; client: PGlite; close(): Promise<void> }>` — in-memory PGlite, migrated with `drizzle-orm/pglite/migrator`.

- [ ] **Step 1: Column helpers** in `types.ts`: `bytea` via `customType<{ data: Buffer; driverData: Buffer | Uint8Array }>` (Drizzle 0.45 has no built-in `bytea`; `fromDriver` wraps `Uint8Array` from PGlite in `Buffer`), and `tstz = (name?) => timestamp({ withTimezone: true, mode: 'date' })`.
- [ ] **Step 2: Schema files**, one per D group: `enums.ts` (7 `pgEnum`s named exactly as D §1 `create type`, values from `@elec/shared`), `auth.ts` (`appUser`, `session`, `refreshToken`, `oneTimeToken`, `apiToken`), `devices.ts` (`device`, `deviceViewer`, `deviceInvite`), `firmware.ts` (`firmwareRelease`, `firmwareUpdateAttempt`), `monitoring.ts` (`deviceBoot`, `deviceDiagnostic`, `outage`), `notifications.ts` (`notificationChannel`, `deviceChannel`, `delivery`), `platform.ts` (`workerHeartbeat`). Every column, default, check, FK action, index name and partial-index `where` matches DATABASE.md §3–§8 exactly. Every table calls `.enableRLS()`. UUID PKs use `.$defaultFn(newId)`; `updated_at` uses `.$onUpdate(() => new Date())`; `outage.duration_s` uses `.generatedAlwaysAs(sql\`extract(epoch from ended_at - started_at)::integer\`)`. Check constraints are written as literal SQL copied from DATABASE.md, so review is a side-by-side read.
- [ ] **Step 3: Generate.** `drizzle.config.ts`: `dialect 'postgresql'`, `schema './src/db/schema/index.ts'`, `out './drizzle'`, `casing 'snake_case'`. Run `npm run db:generate -w server` (`drizzle-kit generate --name=init`). Read the SQL against DATABASE.md; fix the schema and regenerate until they match.
- [ ] **Step 4: Revoke migration.** `drizzle-kit generate --custom --name=revoke_public_roles`, body:

```sql
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select from pg_roles where rolname = r) then
      execute format('revoke all on all tables in schema public from %I', r);
      execute format('revoke all on all sequences in schema public from %I', r);
      execute format('revoke all on all functions in schema public from %I', r);
      execute format('alter default privileges in schema public revoke all on tables from %I', r);
      execute format('alter default privileges in schema public revoke all on sequences from %I', r);
      execute format('alter default privileges in schema public revoke all on functions from %I', r);
    end if;
  end loop;
end $$;
```

- [ ] **Step 5: `createTestDb`** in `server/test/db.ts`, and `migrate.ts` (reads `DATABASE_URL` via `loadConfig`, runs `drizzle-orm/postgres-js/migrator`, closes, exits non-zero on failure).
- [ ] **Step 6: Schema tests** (`schema.test.ts`, one `createTestDb` in `beforeAll`):
  - `migrates a fresh database`: all 17 D tables exist in `public`.
  - `RLS is on for every table, with no policies`: `select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and not relrowsecurity` is empty; `pg_policies` has no rows.
  - `every foreign key column is indexed`: for each FK in `pg_constraint` (`contype = 'f'`), some index on that table has the FK columns as its leading columns (partial indexes count). Empty list of offenders.
  - `ids are UUIDv7`: insert an `app_user` via Drizzle without `id`; the id's version nibble is `7`.
  - `emails must be lowercase`: inserting `email: 'John@Example.com'` throws a check violation.
  - `a user needs a sign-in method`: both `password_hash` and `google_sub` null → check violation.
  - `ONLINE iff offline_at`: device with `state 'ONLINE'` and `offline_at null` → violation; `PENDING` with null → ok.
  - `one open outage per device`: second open outage for the same device → unique violation (`outage_one_open_per_device`).
  - `duration_s is generated`: close an outage 90 s long → `duration_s = 90`.
  - `channel type columns`: a `WEBHOOK` channel with `telegram_chat_id` set → violation; a valid `TELEGRAM_PLATFORM` row inserts.
  - `bytea round-trips`: `sha256('x')` stored in `refresh_token.token_hash` reads back as an equal `Buffer`; a 16-byte value → violation.
- [ ] **Step 7: Run** `npm test -w server -- schema` → PASS. Also `npx -w server drizzle-kit generate` prints no changes.
- [ ] **Commit point:** `server/drizzle.config.ts server/drizzle/ server/src/db/ server/test/db.ts` — `Add database schema and first migration`. 👤 Review `0000_init.sql` and `0001_revoke_public_roles.sql` against DATABASE.md before merging.

### Task 6: Real-Postgres harness and privilege test

**Files:**

- Modify: `server/test/db.ts`
- Create: `server/src/db/privileges.pg.test.ts`

**Interfaces:**

- Produces (test): `pgTestUrl: string | undefined` (= `process.env.TEST_DATABASE_URL`); `createPgTestDb(): Promise<{ db: Db; url: string; sql: postgres.Sql; close(): Promise<void> }>` — connects to `TEST_DATABASE_URL`, creates database `test_<random hex>`, migrates it, and `close()` drops it. Lock / `skip locked` tests in M2+ use this and `describe.skipIf(!pgTestUrl)`.

- [ ] **Step 1: Test** `privileges.pg.test.ts` (`describe.skipIf(!pgTestUrl)`): create a fresh database, create roles `anon` and `authenticated` if missing (they are cluster-wide; ignore `duplicate_object`), run `alter default privileges in schema public grant all on tables to anon, authenticated` to mimic Supabase, then migrate. Assert `has_table_privilege('anon', 'public.device', 'select')` and the same for `authenticated` and `public.app_user` are all `false`, and RLS is on for `device`.
- [ ] **Step 2: Run locally** with a Postgres if one is available: `TEST_DATABASE_URL=postgres://… npm test -w server -- privileges` → PASS. Without it the suite reports as skipped — that's expected; CI runs it (Task 10).
- [ ] **Commit point:** `server/test/db.ts server/src/db/privileges.pg.test.ts` — `Add real Postgres test harness`

### Task 7: App factory, error handler and health

**Files:**

- Create: `server/src/http/errors.ts`, `server/src/http/app.ts`, `server/src/http/health.ts`, `server/src/http/app.test.ts`, `server/src/http/health.test.ts`

**Interfaces:**

- Consumes: `Db`, `Clock`, `Logger`, `Config`.
- Produces: `type AppDeps = { db: Db; clock: Clock; logger: Logger; config: Config }`; `createApp(deps: AppDeps, extraRoutes?: (app: Express) => void): Express` (the hook lets tests mount throwaway routes before the 404 and error handlers); `class HttpError extends Error { constructor(status: number, code: ErrorCode, message: string, details?: unknown[]) }`; `type ErrorCode` = the A §1 code list; `errorHandler: ErrorRequestHandler`; `healthRouter(deps: Pick<AppDeps, 'db'>): Router`.

- [ ] **Step 1: Error tests** (`app.test.ts`, supertest on `createApp` with a stub db and `silentLogger` spy, test routes mounted through `extraRoutes`):
  - `HttpError(409, 'conflict', 'Device is busy')` → `409 {"error":{"code":"conflict","message":"Device is busy"}}`.
  - A route calling `z.object({ ping_interval_s: z.number().int().min(15) }).parse({ ping_interval_s: 5 })` → `400`, `code 'validation_error'`, `message 'Invalid request'`, `details[0]` equals `{ path: 'ping_interval_s', code: 'too_small', min: 15 }` (A §1 example).
  - Nested path: error at `['settings', 'quiet_hours', 0]` → `path 'settings.quiet_hours.0'`.
  - `POST /test/echo` with body `{"a":` and JSON content type → `400 validation_error`, JSON response (Review Focus 1).
  - `GET /nope` and `DELETE /health` → `404 {"error":{"code":"not_found","message":"Not found"}}` (Review Focus 2).
  - A route throwing `new Error('db password is hunter2')` (sync, and an async route rejecting) → `500 {"error":{"code":"internal","message":"Internal error"}}`; body does not contain `hunter2`; `logger.error` called once with the error (Review Focus 3).
  - Responses set `Content-Type: application/json`; `x-powered-by` header is absent.
- [ ] **Step 2: Health tests** (`health.test.ts`): with `createTestDb` → `GET /health` `200 {"status":"ok"}`; with a db stub whose `execute` rejects → `503 {"status":"unavailable"}`; with a stub that never resolves → `503` (use `vi.useFakeTimers` and advance 3 s) (Review Focus 4).
- [ ] **Step 3: Run** → FAIL.
- [ ] **Step 4: Implement.** `createApp`: `express()`, `disable('x-powered-by')`, `express.json({ limit: '100kb' })`, health router, `extraRoutes`, catch-all `notFound`, `errorHandler`. `errorHandler` maps: `HttpError` → its fields; `ZodError` → 400 with `details` = `issues.map(i => ({ path: i.path.join('.'), code: i.code, ...(i.minimum !== undefined && { min: Number(i.minimum) }), ...(i.maximum !== undefined && { max: Number(i.maximum) }) }))`; errors with `type` starting `entity.` or `charset.` (body-parser) → `400 validation_error`; anything else → log and `500 internal`. Health: `db.execute(sql\`select 1\`)` raced against a 3 s timeout.
- [ ] **Step 5: Run** → PASS.
- [ ] **Commit point:** `server/src/http/` — `Add Express app, error handler and health`

### Task 8: OpenAPI document and Swagger UI

**Files:**

- Create: `server/src/http/openapi.ts`, `server/src/http/openapi.test.ts`
- Modify: `server/src/http/app.ts`, `server/src/http/health.ts`, `server/src/http/errors.ts`

**Interfaces:**

- Produces: `errorSchema` (Zod, `.meta({ id: 'Error' })`, matches A §1 including optional `details`); `buildOpenApiDocument(paths: ZodOpenApiPathsObject[]): OpenAPIObject`; `docsRouter(document): Router` mounting `GET /api/v1/openapi.json` and Swagger UI at `/api/docs`. Each route module exports a `paths: ZodOpenApiPathsObject` next to its router; `app.ts` collects them. M1+ add their modules to that list.

- [ ] **Step 1: Tests:** `GET /api/v1/openapi.json` → `200`, `openapi` starts with `'3.1'`, `info.title === 'Electricity Monitor API'`, `components.schemas.Error` exists, `paths['/health'].get.responses` has `200` and `503`. `GET /api/docs/` → `200`, `text/html`, body contains `swagger-ui`. The document builds without throwing (would catch an unregistered or duplicate schema id).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** with `createDocument({ openapi: '3.1.0', info: { title: 'Electricity Monitor API', version: '2.0.0' }, paths: Object.assign({}, ...paths), components: { schemas: { Error: errorSchema } } })`. Swagger UI: `swaggerUi.serve, swaggerUi.setup(undefined, { swaggerOptions: { url: '/api/v1/openapi.json' } })`. Build the document once in `createApp`. `/health` is included in the document (A §7 lists it alongside the docs endpoints).
- [ ] **Step 4: Run** → PASS.
- [ ] **Commit point:** `server/src/http/` — `Serve OpenAPI document and Swagger UI`

### Task 9: Worker loop and heartbeat

**Files:**

- Create: `server/src/worker/loop.ts`, `server/src/worker/loop.test.ts`, `server/src/worker/heartbeat.ts`, `server/src/worker/heartbeat.test.ts`, `server/src/worker.ts`

**Interfaces:**

- Consumes: `Db`, `Clock`, `Logger`, `createDb`, `loadConfig`.
- Produces: `runLoop(opts: { intervalMs: number; tick: () => Promise<void>; signal: AbortSignal; logger: Logger; sleep?: (ms: number, signal: AbortSignal) => Promise<void> }): Promise<void>` — resolves after the signal aborts and the running tick has finished; `beat(db: Db, clock: Clock, worker: string, instanceId: string): Promise<void>`; constants `WORKER_NAME = 'main'`, `LOOP_INTERVAL_MS = 10_000` (D §9 offline check every 10 s).

- [ ] **Step 1: Loop tests** (inject a `sleep` that resolves immediately or on abort):
  - runs `tick` repeatedly until aborted (abort after the 3rd tick → exactly 3 calls).
  - a `tick` that throws once is logged via `logger.error` and the loop runs the next tick (Review Focus 5).
  - abort during `sleep` resolves `runLoop` without another tick.
  - abort while a tick is pending: `runLoop` resolves only after that tick's promise settles (Review Focus 5).
- [ ] **Step 2: Heartbeat tests** (PGlite): `beat` twice with a `FakeClock` advanced 10 s between → one `worker_heartbeat` row, `beat_at` equals the second clock time, `instance_id` updated.
- [ ] **Step 3: Run** → FAIL.
- [ ] **Step 4: Implement.** `beat` = insert … `on conflict (worker) do update set instance_id = excluded.instance_id, beat_at = excluded.beat_at`, with `beat_at: clock.now()`. Default `sleep` = `setTimeout` from `node:timers/promises` with `{ signal }`, swallowing the `AbortError`. `worker.ts`: `loadConfig(process.env)` (on `ConfigError` print the message and `process.exit(1)`), `createDb`, `instanceId = process.env.RENDER_INSTANCE_ID ?? \`${os.hostname()}:${process.pid}\``, an `AbortController`aborted on`SIGTERM`and`SIGINT`, `await runLoop({ tick: () => beat(...) , … })`, then `close()`the db and log`worker stopped`.
- [ ] **Step 5: Run** → PASS.
- [ ] **Commit point:** `server/src/worker/ server/src/worker.ts` — `Add worker loop with heartbeat`

### Task 10: API entry, CI and docs

**Files:**

- Create: `server/src/api.ts`, `.github/workflows/ci.yml`
- Modify: `docs/API.md` (§7), `docs/PROJECT_V2.md` (§12 Config), `docs/ROADMAP.md` (M0 ticks)

**Interfaces:**

- Consumes: everything above.

- [ ] **Step 1: `api.ts`:** `loadConfig` (exit 1 on `ConfigError`), `createDb`, `createApp({ db, clock: systemClock, logger: console, config })`, `listen(config.port)`. On `SIGTERM` / `SIGINT`: `server.close()`, then db `close()`, exit 0.
- [ ] **Step 2: CI** `.github/workflows/ci.yml`, on `pull_request` and `push` to `main` and `v2`. One job `check` on `ubuntu-latest`, service `postgres:17` (`POSTGRES_PASSWORD: postgres`, health check `pg_isready`, port 5432), `env.TEST_DATABASE_URL: postgres://postgres:postgres@localhost:5432/postgres`. Steps: checkout, `actions/setup-node` (node 26, npm cache), `npm ci`, `npm run lint`, `npm run fmt:check`, `npm run typecheck`, `npm run build`, `npm test`, then the migration drift check: `npx -w server drizzle-kit generate` followed by `git diff --exit-code -- server/drizzle` and `test -z "$(git status --porcelain server/drizzle)"`.
- [ ] **Step 3: Docs.** A §7: `/health` returns `503 {"status":"unavailable"}` when the DB is unreachable or doesn't answer in 3 s. P §12 Config: add `PORT=3000` and one sentence: each milestone adds its keys when code first reads them; the process exits on a missing or invalid key. ROADMAP: tick the M0 deliverables.
- [ ] **Step 4: Verify locally:** `npm ci && npm run lint && npm run fmt:check && npm run typecheck && npm run build && npm test` — all exit 0.
- [ ] **Commit point:** `server/src/api.ts .github/workflows/ci.yml docs/API.md docs/PROJECT_V2.md docs/ROADMAP.md` — `Add API entry point and CI workflow`

**M0 done when (ROADMAP):** CI green on a pull request; tests migrate a fresh DB, `/health` passes, i18n parity passes. 👤 By hand:

- Review the first migration SQL against DATABASE.md.
- Open the PR and confirm the `check` job is green, including the `privileges` suite (not skipped).
- In GitHub branch protection for `main`, mark `check` as required.
- Locally, with a Postgres running and `server/.env` set from `.env.example` (the current `server/.env` holds v1 keys): `npm run db:migrate -w server`, `npm run dev:api -w server`, then open `http://localhost:3000/health` and `http://localhost:3000/api/docs/`; `npm run dev:worker -w server` and check a `worker_heartbeat` row appears and updates every 10 s; Ctrl-C stops both cleanly.
