# WattNexa — project knowledge

Deeper reference for working in this repo. `AGENTS.md` holds the short always-loaded version;
`docs/` carries the deep contracts.

## Goal

"Know exactly where your electricity bill is going." Monitor a household's electricity, explain
what changed, and translate consumption into the amount the user actually pays.

## Docs index

- `docs/WATTBOT.md` — assistant safety model, providers, quotas, operations.
- `docs/HARDWARE.md` — device contract, MQTT topics/ACLs, ESP32 reference sketch.
- `docs/DEPLOYMENT.md` — Vercel frontend, long-lived API host, managed MariaDB runbook.

## Layout

```
apps/web/                 React 18 + Vite + Tailwind + Radix primitives
  src/pages/Landing.tsx   marketing homepage
  src/pages/public/       features, pricing, faq, about, contact, blog, legal
  src/pages/auth/         login, register, verify, forgot, reset
  src/pages/app/          dashboard, devices, energy, billing, wattbot, alerts, settings, admin
  src/components/ui/      button, card, forms, feedback, toast
  src/providers/          theme + auth (TanStack Query)
  src/lib/                api client, hooks, socket, wattbot-stream, utilities
apps/api/
  src/modules/            auth, users, homes, devices, telemetry, energy, billing,
                          alerts, wattbot, reports, subscriptions, admin, public, dev
  src/services/           energy queries, telemetry ingest, alert engine, realtime, accounts,
                          wattbot/{index,providers,tools,answer,quota,daterange,knowledge}
  src/middleware/         auth, device-auth, validate, error, rate-limit, csrf
  src/integrations/       MQTT
  src/jobs/               scheduler (offline sweep + hourly rollup)
  src/utils/errors.ts     AppError helpers, formatted by the central error handler
  tests/                  integration tests (need MariaDB + seed)
  scripts/simulator.ts    simulated telemetry publisher
packages/
  config/                 Zod-validated env (loads root .env by walking up from cwd)
  types/                  shared DTOs
  shared/                 tariff math, aggregation, ranges, formatters, Zod schemas, tests
  database/               Drizzle schema (36 tables), migrations, seed, reset
```

## Commands

```bash
cp .env.example .env            # only if .env is missing
pnpm install
pnpm docker:up                  # MariaDB 11 on :3306 (Docker Desktop must be running)
pnpm db:migrate && pnpm db:seed
pnpm dev                        # API :4000 + web :5173

pnpm typecheck                  # reliable repo-wide gate; currently passes
pnpm test                       # every suite; needs MariaDB up and migrated+seeded

pnpm --filter @wattnexa/shared test        # tariff/aggregation math
pnpm --filter @wattnexa/web test           # jsdom, src/**/*.test.tsx
pnpm --filter @wattnexa/api test           # telemetry, device auth, MQTT, WattBot
pnpm --filter @wattnexa/shared exec vitest run src/energy.test.ts   # single file

pnpm build                      # API via tsup, web via tsc --noEmit && vite build
pnpm db:generate                # after editing packages/database/src/schema/*
pnpm db:reset                   # drop, migrate, reseed (refuses NODE_ENV=production)
pnpm simulate [-- --fast]       # writes simulated rows straight to MariaDB
pnpm --filter @wattnexa/api kb:reindex   # rebuild WattBot knowledge chunks/vectors
```

- Run pnpm from the repo root so `@wattnexa/config` finds the root `.env`.
- The API exits at startup if MariaDB is unreachable (`apps/api/src/server.ts`); start Docker first.
- API tests are integration tests: they log in as the seeded demo/admin users.
  `telemetry.test.ts` creates and removes its own user/home/device.
- `NODE_ENV=test` disables every rate limiter, so 429 paths are never exercised by tests.
- `pnpm lint` fails: no workspace defines a `lint` script and there is no ESLint config. Don't add one.
- Demo user `demo@wattnexa.com` / `WattNexa@123`; Swagger at `/docs`; readiness at `/health/ready`.

## Environment

All variables live in `.env.example`; `@wattnexa/config` validates them with Zod and loads the root
`.env` by walking up from the cwd. The ones that change behavior most:

- `DATABASE_URL` — must be port 3306 to match Compose.
- `SENSOR_MODE` (`simulated` | `hardware`), `OFFLINE_THRESHOLD_SECONDS` (default 120).
- `MQTT_ENABLED` / `MQTT_URL` / `MQTT_TOPIC_PREFIX` — disabled by default; the adapter reports itself
  disabled rather than pretending telemetry arrives.
- `COOKIE_SAME_SITE` (`lax` | `none`) — `none` forces `Secure` and is required when the SPA and API
  are on different sites; `CORS_ORIGINS` must list the frontend origin(s).
- `WATTBOT_PROVIDER` (`none` | `openai` | `anthropic`), `WATTBOT_TIMEOUT_MS`,
  `WATTBOT_EMBEDDING_PROVIDER` — see the WattBot section.
- `SMTP_*` — when unset, mail goes to the in-memory outbox at `/api/v1/dev/outbox`.
- `VITE_API_URL` / `VITE_SOCKET_URL` — the only frontend-visible vars; everything else stays API-only.

## Data model highlights

- `device_telemetry` — raw readings, indexed on `(device_id, recorded_at)`. Nullable measurement
  columns mean "not sensed". Every row carries `source: 'hardware' | 'simulated'`.
- `energy_aggregates` — hourly/daily rollups, unique on `(device_id, bucket, bucket_start)`.
- `tariffs` + `tariff_slabs` — progressive block tariffs (min/max kWh, rate).
- `device_credentials` — hashed per-device tokens with revocation.
- `device_events` — every device status transition.
- `wattbot_conversations` / `wattbot_messages` — persisted per user, scoped by `userId`.
- `subscription_plans` — includes `wattbotMessagesPerDay` (Free 0 = not included, Plus 20, Pro 100).
- `audit_logs` — actor, action, resource for administrative changes.
- Schema files: `core.ts` (users/sessions/verification), `energy.ts` (homes/devices/telemetry/
  tariffs/appliances), `platform.ts` (alerts, billing, WattBot, support, CMS-ish tables, settings),
  `_columns.ts` (shared column helpers).

## Energy & billing semantics

- `energyTotal` / SQL series prefer `MAX(energy_kwh) - MIN(energy_kwh)`; when a device reports no
  cumulative energy, average power is integrated over the bucket and is an estimate.
- `calculateCost` is a progressive slab calculation plus fixed charge and tax; units above the last
  slab use the last rate rather than being dropped.
- `projectMonthly` is linear extrapolation and is labelled a projection.
- Zero stored samples must be reported as "no readings", never as 0 kWh.

## Auth

- Access JWT (15 min) + opaque refresh token (1 day, or 30 with "remember me").
- Both live in HTTP-only cookies (`wnx_at`, `wnx_rt`), SameSite=Lax by default; cross-site deploys
  need `COOKIE_SAME_SITE=none` (forces Secure). Refresh tokens rotate; only a SHA-256 hash is
  persisted in `user_sessions`.
- `requireAuth` re-reads the user each request so suspensions apply immediately.
- CSRF: SameSite cookies plus an Origin allow-list check on state-changing requests.
- Every home/device query goes through `requireHomeAccess` / `requireDeviceAccess` / `accessible*`
  in `apps/api/src/lib/ownership.ts`.
- Device auth is a per-device bearer token (`wnx_dev_...`), shown once, stored only as SHA-256.
- Development affordances: verification codes and reset tokens are returned in the response body
  when `NODE_ENV !== production`; emails land in `/api/v1/dev/outbox` when SMTP is unset.

## API conventions

- `validate(schema)` parses input; read it with `bodyOf` / `queryOf` / `paramsOf` from
  `req.validated`, never raw `req.body` / `req.query`.
- Responses are `{ success: true, data }` or `{ success: false, error: { code, message, details } }`.
  Throw `AppError` helpers; the central handler formats them.
- Business math lives in `packages/shared`; never re-implement tariffs or aggregation in routes or
  components. Test changes in `packages/shared`.

## Realtime

Socket.IO at `/socket.io`. Handshake authenticates from the access cookie; sockets join
`user:<id>` and `home:<id>`. Events: `telemetry:new`, `device:status`, `alert:new`,
`device:removed`. The client hook (`src/lib/socket.ts`) invalidates TanStack Query caches on those
events.

## Devices & telemetry

- HTTP ingest at `POST /api/v1/telemetry`; MQTT topics `<prefix>/devices/<serial>/{telemetry,status,commands}`
  (legacy `<prefix>/<serial>/telemetry` still accepted). MQTT is implemented but has never run
  against physical hardware.
- Telemetry is idempotent on `(device_id, message_id)`; without one, the exact `(device, timestamp)`
  pair is deduplicated. Never bypass that unique index.
- Device status (`online`/`offline`/`connecting`/`not_configured`/`error`) is written only by
  `applyDeviceStatus()` from real traffic; pairing never marks a device online. A 60-second sweep
  marks silent devices offline.
- Seeded and simulated rows are always `source='simulated'`; the dashboard shows the badge.

## WattBot

- The model never gets SQL or tools. `collectFacts()` runs fixed, `requireHomeAccess`-scoped queries
  and builds a provenance-labelled fact sheet; providers only rewrite that sheet. Suggestions are
  server-derived from device/tariff/data state and the current screen name (`buildSuggestions`).
- Product retrieval: approved corpus in `services/wattbot/knowledge.ts`, chunked by
  `chunkKnowledgeDocuments()`. Optional OpenAI embeddings are stored in `wattbot_knowledge_chunks`
  (MariaDB, cosine scored in process); lexical retrieval is the always-available fallback. Re-index
  with `pnpm --filter @wattnexa/api kb:reindex`.
- Alert notifications carry a deterministic `metadata.wattbotInsight`; categories/actions come from
  `services/notification-view.ts` and never include appliance switching.
- `WATTBOT_PROVIDER=none` is the supported default: `ruleBasedAnswer` answers and rows are stored as
  `provider='rule_based'`. Missing keys, timeouts, 429s, and empty/malformed output all fall back to
  it. `GET /wattbot/status` is the source of truth; never imply an LLM is active unless `configured`.
- Explicit dates in a question are parsed by `services/wattbot/daterange.ts` into a bounded UTC
  window (max 366 days) and aggregated via `collectFacts(scope, { customRange })`.
- `assertWattbotQuota()` runs before the conversation row and any provider call; only user questions
  count, day boundary is UTC. Never treat 0 as unlimited.
- Streaming is SSE (`meta`/`delta`/`done`/`error`) from `POST /wattbot/messages/stream`; the web
  client parses it with a fetch reader because `EventSource` can't send cookies or a JSON body.
  The non-streaming endpoint returns the same answer data for tests and other clients.
- Foreign conversation ids return 404. Messages are 1–2000 chars and limited to 20/min/user.
- Provider adapters are implemented but have not been exercised with real keys.

## Gotchas

- `DATABASE_URL` must use port **3306** (`mysql://wattnexa:wattnexa@localhost:3306/wattnexa`); a
  mismatch surfaces as "Database unreachable".
- Use pnpm. `package-lock.json` is tracked but `pnpm-lock.yaml` is authoritative (Vercel installs
  with `--frozen-lockfile`); don't regenerate the npm lockfile.
- `pnpm-workspace.yaml` gates install scripts via `allowBuilds`; pnpm blocks them by default.
- Workspace packages export raw TypeScript (`main`/`exports` → `src/index.ts`). A new package must
  be wired into `apps/api/tsup.config.ts` (`noExternal` covers `@wattnexa/*`),
  `apps/web/vite.config.ts` aliases and `apps/web/tsconfig.json` paths.
- `VITE_`-prefixed variables are compiled into the public web bundle — AI keys stay API-only.
- No CI/CD exists and none should be added. Frontend deploys to Vercel from root `vercel.json`; the
  API is a long-lived Node process (WebSockets + MQTT), not a serverless function.

## Verification

```bash
pnpm typecheck
pnpm --filter @wattnexa/api test
pnpm build
curl localhost:4000/health/ready         # database reachability
```

## Not implemented yet

- Payment gateway (sandbox only), Excel export (CSV/PDF exist), support-ticket UI, blog CMS UI.
- Automation rules are stored and editable but not executed by the scheduler yet.
- Route-level code splitting for the web bundle.
- Real-provider WattBot calls are untested; MQTT is untested against hardware.
