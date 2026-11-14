# AGENTS.md

WattNexa — IoT electricity-monitoring SaaS. ESP32/CT readings stream into an Express API; the React
dashboard prices kWh with the user's own tariff slabs. pnpm monorepo: `apps/{api,web}` and
`packages/{config,types,shared,database}`. `knowledge.md` has deeper auth/realtime/data-model notes;
`docs/WATTBOT.md` and `docs/HARDWARE.md` document those contracts; `docs/DEPLOYMENT.md` covers
operations.

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
- `pnpm test` — all suites pass **after MariaDB is up and `pnpm db:migrate && pnpm db:seed` has run**.
  The API tests (`apps/api/tests/*.test.ts`) are integration tests: they log in as the seeded
  demo/admin users; `telemetry.test.ts` creates and removes its own user/home/device.
  - `pnpm --filter @wattnexa/shared test` (tariff/aggregation math)
  - `pnpm --filter @wattnexa/web test` (jsdom, `src/**/*.test.tsx`)
  - `pnpm --filter @wattnexa/api test` (telemetry pipeline, device auth, MQTT handler, WattBot)
  - `pnpm --filter @wattnexa/shared exec vitest run src/energy.test.ts` (single file)
- `pnpm lint` — fails; no workspace defines a `lint` script and there is no ESLint config. Don't add
  one unless asked.
- `pnpm build` — API via tsup (`apps/api/dist`), web via `tsc --noEmit && vite build`.
- `pnpm db:generate` — after editing `packages/database/src/schema/*`; generated SQL is tracked in
  `packages/database/drizzle/`.
- `pnpm db:migrate` creates the database if missing (drizzle-kit alone does not).
- `pnpm db:seed` inserts plans, the demo household + "Main Meter" device and 30 days of
  **simulated** readings.
- `pnpm --filter @wattnexa/api kb:reindex` rebuilds the WattBot knowledge index after editing
  `services/wattbot/knowledge.ts` or changing the embedding model.
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

## WattBot

- Code: `apps/api/src/services/wattbot/{index,providers,tools,answer,quota}.ts` and
  `apps/api/src/modules/wattbot.routes.ts`; web UI in `apps/web/src/pages/app/Wattbot.tsx` +
  `apps/web/src/lib/wattbot-stream.ts`. Runbook and current limits: `docs/WATTBOT.md`.
- The model never gets SQL or tools. `collectFacts()` runs fixed, `requireHomeAccess`-scoped queries
  and builds a provenance-labelled fact sheet; providers only rewrite that sheet. Suggestions are
  server-derived by `buildSuggestions(facts, context)` from device/tariff/data state and the current
  screen name, not generated by a model.
- Retrieval uses the approved corpus in `services/wattbot/knowledge.ts`. Semantic retrieval is
  optional (`WATTBOT_EMBEDDING_PROVIDER=openai`), indexes chunks into `wattbot_knowledge_chunks`,
  and always falls back to lexical scoring. Every embedded vector is stored in MariaDB; there is no
  second database or vector service.
- Alerts store a deterministic `metadata.wattbotInsight` at creation time (no model call per
  reading). Notification categories and actions are derived by `services/notification-view.ts`;
  never render an action the API cannot perform (there is no appliance switching).
- `WATTBOT_PROVIDER=none` is the supported default: `ruleBasedAnswer` answers and rows are stored as
  `provider='rule_based'`. Missing keys, timeouts, 429s, and empty/malformed provider output all take
  the same fallback. `GET /wattbot/status` is the source of truth for the UI; never imply an LLM is
  active when `configured` is false.
- Explicit dates in a question are parsed by `services/wattbot/daterange.ts` into a bounded UTC
  window (max 366 days) and aggregated via `collectFacts(scope, { customRange })`. The model never
  picks the window. Zero stored samples must be reported as "no readings", never as 0 kWh.
- Quotas come from `subscription_plans.wattbotMessagesPerDay` (Free 0 = **not included**, Plus 20,
  Pro 100) via `assertWattbotQuota()`, which runs before the conversation row and any provider call.
  Only user questions count; the day boundary is UTC. Never treat 0 as unlimited.
- Streaming is SSE (`meta`/`delta`/`done`/`error`) from `POST /wattbot/messages/stream`; the web
  client parses it with a fetch reader because `EventSource` cannot send cookies or a JSON body. The
  non-streaming endpoint returns the same answer data for tests and other clients.
- Conversations persist in `wattbot_conversations` / `wattbot_messages`, scoped by `userId`; foreign
  ids return 404. Messages are 1–2000 chars and limited to 20/min/user. Per-plan quotas exist in the
  schema (`wattbot_messages_per_day`) but are **not enforced**.
- Config: `WATTBOT_PROVIDER`, `OPENAI_API_KEY`/`OPENAI_MODEL`, `ANTHROPIC_API_KEY`/`ANTHROPIC_MODEL`,
  `WATTBOT_TIMEOUT_MS`, `WATTBOT_CONTEXT_MESSAGES`, `WATTBOT_MAX_TOKENS`, `WATTBOT_TEMPERATURE`.
  Provider adapters are implemented but have not been exercised with real keys; tests cover the
  deterministic fallback.

## Domain invariants

- Every telemetry row carries `source: 'hardware' | 'simulated'`; never mix them silently. Seed and
  simulator data are simulated by design, so the dashboard shows the "Simulated data" badge.
- Unavailable measurements are `NULL`, never `0`; the UI renders them as "unavailable".
- Money is an estimate. Every cost surface keeps its disclaimer; the provider's bill wins.
- WattBot may only state what `collectFacts()` returned: never invent readings, tariffs, savings or
  device capabilities. If the tariff is missing, ask the user to configure it; label estimates and
  simulated data; refuse appliance-level attribution from one whole-house CT.
- Device auth is a per-device bearer token (`wnx_dev_...`), shown once and stored only as SHA-256.
  User sessions use HTTP-only cookies `wnx_at` / `wnx_rt`.
- Telemetry is idempotent on `(device_id, message_id)`; without a `message_id` the exact
  `(device, timestamp)` pair is deduplicated. Never bypass that unique index.
- Device status (`online`/`offline`/`connecting`/`not_configured`/`error`) is written only by
  `applyDeviceStatus()` from real traffic, and every transition is appended to `device_events`.
  Pairing never marks a device online.
- MQTT topics are `<prefix>/devices/<serial>/{telemetry,status,commands}` (`docs/HARDWARE.md`); the
  legacy short form `<prefix>/<serial>/telemetry` is still accepted. The adapter is implemented but
  has never been run against physical hardware.
- Timestamps are stored in UTC and rendered in the viewer's locale.

## Gotchas

- `DATABASE_URL` must use port **3306** (`mysql://wattnexa:wattnexa@localhost:3306/wattnexa`) to match
  Compose; a mismatch surfaces as "Database unreachable".
- Use pnpm. `package-lock.json` is tracked but `pnpm-lock.yaml` is authoritative (Vercel installs with
  `--frozen-lockfile`); don't regenerate the npm lockfile.
- `pnpm-workspace.yaml` gates install scripts via `allowBuilds`; pnpm blocks them by default.
- Cross-site frontend/API deployments require `COOKIE_SAME_SITE=none` (forces Secure) or browsers
  drop the session cookies.
- `NODE_ENV=test` disables every rate limiter, so the API tests never exercise 429 responses.
- AI keys are API-only. Any variable prefixed `VITE_` is compiled into the public web bundle.
