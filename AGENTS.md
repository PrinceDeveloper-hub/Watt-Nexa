# AGENTS.md

WattNexa — IoT electricity-monitoring SaaS. ESP32/CT readings stream into an Express API; the React
dashboard prices kWh with the user's own tariff slabs. pnpm monorepo: `apps/{api,web}` and
`packages/{config,types,shared,database}`. `knowledge.md` has deeper auth/realtime/data-model notes;
`docs/DEPLOYMENT.md` covers operations.

## Setup

```bash
pnpm install
pnpm docker:up                  # MariaDB 11 on :3306 (Docker Desktop must be running)
pnpm db:migrate && pnpm db:seed
pnpm dev                        # API :4000 + web :5173
```

- Run pnpm from the repo root. `@wattnexa/config` finds the root `.env` by walking up from the cwd.
- The API exits at startup if MariaDB is unreachable (`apps/api/src/server.ts`). Start Docker first.
- Demo user `demo@wattnexa.com` / `WattNexa@123`; Swagger at `/docs`; readiness at `/health/ready`.

## Commands

- `pnpm typecheck` — the reliable repo-wide gate; it currently passes. Run it before claiming success.
- `pnpm test` — currently **fails overall**: `apps/api/vitest.config.ts` expects `tests/**/*.test.ts`
  but that directory does not exist. Run the suites that exist instead:
  - `pnpm --filter @wattnexa/shared test` (tariff/aggregation math)
  - `pnpm --filter @wattnexa/web test` (jsdom, `src/**/*.test.tsx`)
  - `pnpm --filter @wattnexa/shared exec vitest run src/energy.test.ts` (single file)
- `pnpm lint` — fails; no workspace defines a `lint` script and there is no ESLint config. Don't add
  one unless asked.
- `pnpm build` — API via tsup (`apps/api/dist`), web via `tsc --noEmit && vite build`.
- `pnpm db:generate` — after editing `packages/database/src/schema/*`; generated SQL is tracked in
  `packages/database/drizzle/`.
- `pnpm db:migrate` creates the database if missing (drizzle-kit alone does not).
- `pnpm db:seed` inserts plans, the demo household + "Main Meter" device and 30 days of
  **simulated** readings.
- `pnpm db:reset` drops, migrates and reseeds; it refuses to run when `NODE_ENV=production`.
- `pnpm simulate` (`-- --fast`) writes readings directly to MariaDB from its own process — the API
  need not be running, but seed must have created a device. Seeded and simulated rows are always
  stored with `source='simulated'`.

## Architecture

- API entry: `src/server.ts` → `app.ts`; routers in `src/modules/*.routes.ts`, mounted under
  `/api/v1` in `src/routes/index.ts`. Logic shared by routes lives in `src/services` and `src/lib`.
- Business math (`calculateCost`, `aggregateSamples`, `resolveRange`, formatters, Zod schemas) lives in
  `packages/shared`. Never re-implement tariffs or aggregation inside routes/components; test changes
  in `packages/shared`.
- Every home/device query must pass through `requireHomeAccess` / `requireDeviceAccess` /
  `accessible*` in `apps/api/src/lib/ownership.ts`. Do not query a resource without checking membership.
- Responses are `{ success: true, data }` or `{ success: false, error: { code, message, details } }`.
  Throw `AppError` helpers from `apps/api/src/utils/errors.ts`; the central handler formats them.
- Validation uses Zod via `validate()`; read parsed/coerced input with `bodyOf` / `queryOf` /
  `paramsOf` from `req.validated`, not raw `req.body` / `req.query`.
- Web: routes in `src/App.tsx`, feature pages in `src/pages`, primitives in `src/components/ui`,
  TanStack Query hooks in `src/lib/hooks.ts`. `src/lib/api.ts` prefixes `/api/v1`, sends cookies and
  retries once after `/auth/refresh`. Base URL is `VITE_API_URL`, else same-origin via the Vite proxy
  (`/api`, `/socket.io` → `:4000`).
- Workspace packages export raw TypeScript (`main`/`exports` → `src/index.ts`). If you add one, wire
  it into `apps/api/tsup.config.ts` (`noExternal` covers `@wattnexa/*`), `apps/web/vite.config.ts`
  aliases and `apps/web/tsconfig.json` paths.
- No CI/CD exists and none should be added. The frontend deploys to Vercel from the root
  `vercel.json`; the API is a long-lived Node process. See `docs/DEPLOYMENT.md`.

## Domain invariants

- Every telemetry row carries `source: 'hardware' | 'simulated'`; never mix them silently. Seed and
  simulator data are simulated by design, so the dashboard shows the "Simulated data" badge.
- Unavailable measurements are `NULL`, never `0`; the UI renders them as "unavailable".
- Money is an estimate. Every cost surface keeps its disclaimer; the provider's bill wins.
- Device auth is a per-device bearer token (`wnx_dev_...`), shown once and stored only as SHA-256.
  User sessions use HTTP-only cookies `wnx_at` / `wnx_rt`.
- Timestamps are stored in UTC and rendered in the viewer's locale.

## Gotchas

- `DATABASE_URL` must use port **3306** (`mysql://wattnexa:wattnexa@localhost:3306/wattnexa`) to match
  Compose; a mismatch surfaces as "Database unreachable".
- Use pnpm. `package-lock.json` is tracked but `pnpm-lock.yaml` is authoritative (Vercel installs with
  `--frozen-lockfile`); don't regenerate the npm lockfile.
- `pnpm-workspace.yaml` gates install scripts via `allowBuilds`; pnpm blocks them by default.
- Cross-site frontend/API deployments require `COOKIE_SAME_SITE=none` (forces Secure) or browsers
  drop the session cookies.
