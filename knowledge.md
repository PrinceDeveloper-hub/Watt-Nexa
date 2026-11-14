# WattNexa — project knowledge

Deeper reference for working in this repo. `AGENTS.md` holds the short always-loaded version.

## Goal

"Know exactly where your electricity bill is going." Monitor a household's electricity, explain
what changed, and translate consumption into the amount the user actually pays.

## Layout

```
apps/web/                 React 18 + Vite + Tailwind + Radix primitives
  src/pages/Landing.tsx   marketing homepage
  src/pages/public/       features, pricing, faq, about, contact, blog, legal
  src/pages/auth/         login, register, verify, forgot, reset
  src/pages/app/          dashboard, devices, energy, billing, wattbot, alerts, settings, admin
  src/components/ui/      button, card, forms, feedback, toast
  src/providers/          theme + auth (TanStack Query)
  src/lib/                api client, hooks, socket, utilities
apps/api/
  src/modules/            auth, users, homes, devices, telemetry, energy, billing,
                          alerts, wattbot, reports, subscriptions, admin, public, dev
  src/services/           energy queries, telemetry ingest, alert engine, realtime, wattbot
  src/middleware/         auth, device-auth, validate, error, rate-limit, csrf
  src/integrations/       MQTT
  src/jobs/               scheduler (offline sweep + hourly rollup)
  scripts/simulator.ts    simulated telemetry publisher
packages/
  config/                 Zod-validated env (loads root .env)
  types/                  shared DTOs
  shared/                 tariff math, aggregation, ranges, formatters, Zod schemas, tests
  database/               Drizzle schema (30 tables), migrations, seed, reset
```

## Data model highlights

- `device_telemetry` — raw readings, indexed on `(device_id, recorded_at)`. Nullable measurement
  columns mean "not sensed".
- `energy_aggregates` — hourly/daily rollups, unique on `(device_id, bucket, bucket_start)`.
- `tariffs` + `tariff_slabs` — progressive block tariffs (min/max kWh, rate).
- `device_credentials` — hashed per-device tokens with revocation.
- `audit_logs` — actor, action, resource for administrative changes.

## Energy & billing semantics

- `energyTotal` / SQL series prefer `MAX(energy_kwh) - MIN(energy_kwh)`; when a device reports no
  cumulative energy, average power is integrated over the bucket and is an estimate.
- `calculateCost` is a progressive slab calculation plus fixed charge and tax; units above the last
  slab use the last rate rather than being dropped.
- `projectMonthly` is linear extrapolation and is labelled a projection.

## Auth

- Access JWT (15 min) + opaque refresh token (1 day, or 30 with "remember me").
- Both live in HTTP-only, SameSite=Lax cookies (`wnx_at`, `wnx_rt`). Refresh tokens rotate; only a
  SHA-256 hash is persisted in `user_sessions`.
- `requireAuth` re-reads the user each request so suspensions apply immediately.
- CSRF: SameSite cookies plus an Origin allow-list check on state-changing requests.
- Development affordances: verification codes and reset tokens are returned in the response body
  when `NODE_ENV !== production`; emails also land in `/api/v1/dev/outbox` when SMTP is unset.

## Realtime

Socket.IO at `/socket.io`. Handshake authenticates from the access cookie; sockets join
`user:<id>` and `home:<id>`. Events: `telemetry:new`, `device:status`, `alert:new`, `device:removed`.
The client hook (`src/lib/socket.ts`) invalidates TanStack Query caches on those events.

## Verification

```bash
pnpm typecheck          # all workspaces
pnpm --filter @wattnexa/shared test     # tariff + aggregation unit tests
pnpm --filter @wattnexa/web build       # production bundle
curl localhost:4000/health/ready         # database reachability
```

## Not implemented yet

- Payment gateway (sandbox only), Excel export, support-ticket UI, blog CMS UI.
- Automation rules are stored and editable but not executed by the scheduler yet.
- Route-level code splitting for the web bundle.
- Integration/E2E test suites (domain unit tests exist).
