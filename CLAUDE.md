# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**WattNexa** — IoT electricity-monitoring SaaS. ESP32/CT readings stream into an Express API; the React dashboard prices kWh with the user's own tariff slabs. pnpm monorepo with `apps/{api,web}` and `packages/{config,types,shared,database}`.

## Key Files for Context

- `AGENTS.md` — Short always-loaded instructions (setup, commands, architecture, invariants)
- `knowledge.md` — Deeper auth/realtime/data-model notes
- `docs/DEPLOYMENT.md` — Operations runbook
- `docs/HARDWARE.md` — Device integration contract (MQTT topics, ESP32 reference)
- `README.md` — Quick start and project overview

## Common Commands

```bash
# Development
pnpm install                     # Install dependencies
pnpm docker:up                   # Start MariaDB (Docker Desktop must be running)
pnpm db:migrate && pnpm db:seed  # Create schema + demo data
pnpm dev                         # API :4000 + web :5173 (parallel)

# Building & Typechecking
pnpm build                       # Build both apps (api via tsup, web via tsc+vite)
pnpm typecheck                   # TypeScript across all workspaces (the reliable gate)

# Testing
pnpm --filter @wattnexa/shared test         # Tariff/aggregation math (Vitest)
pnpm --filter @wattnexa/web test            # jsdom component tests (src/**/*.test.tsx)
pnpm --filter @wattnexa/shared exec vitest run src/energy.test.ts  # Single file
# Note: pnpm test fails overall — API vitest.config.ts expects tests/**/*.test.ts but no such dir exists

# Database
pnpm db:generate                 # After editing packages/database/src/schema/*
pnpm db:migrate                  # Creates DB if missing (drizzle-kit alone doesn't)
pnpm db:seed                     # Inserts plans, demo household, "Main Meter", 30 days simulated readings
pnpm db:reset                    # Drop, migrate, reseed (refuses when NODE_ENV=production)

# Simulation
pnpm simulate                    # Writes readings directly to MariaDB (--fast for speed)
```

## Architecture Overview

### Monorepo Structure

```
apps/
  api/          Express API (Node 20+, Express 4, Socket.IO, MQTT)
    src/
      server.ts → app.ts          Entry point, DB check, graceful shutdown
      app.ts                      Express setup, middleware, routes, Swagger
      routes/index.ts             Mounts all module routers under /api/v1
      modules/*.routes.ts         Domain routers (auth, devices, telemetry, energy, billing, alerts, etc.)
      services/                   Business logic (telemetry ingest, energy queries, alert engine, realtime)
      lib/                        Shared utilities (logger, ownership checks, origin validation)
      middleware/                 Auth, device-auth, validate (Zod), error, rate-limit, CSRF
      integrations/mqtt.ts        MQTT client for ESP32 telemetry
      jobs/scheduler.ts           Offline sweep + hourly rollup
      scripts/simulator.ts        Simulated telemetry publisher
  web/          React 18 + Vite + Tailwind + Radix + Recharts + TanStack Query
    src/
      App.tsx                     Routes, auth guards (RequireAuth, RequireAdmin)
      pages/
        app/                      Dashboard, Devices, Energy, Billing, WattBot, Alerts, Settings, Admin
        auth/                     Login, Register, Verify, Forgot, Reset
        public/                   Marketing pages
      components/ui/              Primitives (button, card, forms, feedback, toast)
      providers/                  Auth + TanStack Query providers
      lib/
        api.ts                    API client (prefixes /api/v1, cookies, retry on 401)
        hooks.ts                  TanStack Query hooks
        socket.ts                 Socket.IO client (invalidates query caches on events)

packages/
  config/       Zod-validated environment (loads root .env by walking up from cwd)
  types/        Shared DTO/domain types (dependency-free, used by API + web)
  shared/       Business math: tariff calculation, aggregation, formatters, ranges, Zod schemas
  database/     Drizzle schema (30 tables), migrations, seed, reset
```

### API Request Flow

```
Request → validate() (Zod) → req.validated (bodyOf/queryOf/paramsOf)
  → requireAuth / requireHomeAccess / requireDeviceAccess (ownership.ts)
  → Service logic (uses @wattnexa/shared for math)
  → { success: true, data } | { success: false, error: { code, message, details } }
  → AppError helpers (apps/api/src/utils/errors.ts) caught by central errorHandler
```

### Key Patterns

- **Validation**: Use `validate(schema)` middleware; read parsed input via `bodyOf`/`queryOf`/`paramsOf` from `req.validated`
- **Ownership**: Every home/device query must pass through `requireHomeAccess` / `requireDeviceAccess` / `accessible*` in `apps/api/src/lib/ownership.ts`
- **Shared Math**: Tariff calculation (`calculateCost`), aggregation (`aggregateSamples`), ranges (`resolveRange`), formatters — all in `packages/shared`. Never re-implement in routes/components.
- **Responses**: `{ success: true, data }` or `{ success: false, error: { code, message, details } }`
- **Web API Client**: `src/lib/api.ts` prefixes `/api/v1`, sends cookies, retries once after `/auth/refresh`
- **Realtime**: Socket.IO at `/socket.io` — handshake from access cookie, joins `user:<id>` and `home:<id>`. Events: `telemetry:new`, `device:status`, `alert:new`, `device:removed`. Client hook invalidates TanStack Query caches.

## Domain Invariants (Enforced in Code)

1. Every telemetry row carries `source: 'hardware' | 'simulated'` — never mix silently. Seed/simulator data is `simulated`; dashboard shows "Simulated data" badge.
2. Unavailable measurements are `NULL`, never `0`; UI renders as "unavailable".
3. Money is an estimate — every cost surface keeps its disclaimer; provider's bill wins.
4. Device auth: per-device bearer token (`wnx_dev_...`), shown once, stored only as SHA-256. User sessions: HTTP-only cookies `wnx_at` / `wnx_rt`.
5. Timestamps stored in UTC, rendered in viewer's locale.

## Gotchas

- `DATABASE_URL` must use port **3306** (`mysql://wattnexa:wattnexa@localhost:3306/wattnexa`) to match Compose; mismatch surfaces as "Database unreachable".
- Use **pnpm**. `package-lock.json` is tracked but `pnpm-lock.yaml` is authoritative (Vercel uses `--frozen-lockfile`); don't regenerate npm lockfile.
- `pnpm-workspace.yaml` gates install scripts via `allowBuilds`; pnpm blocks them by default.
- Cross-site frontend/API deployments require `COOKIE_SAME_SITE=none` (forces Secure) or browsers drop session cookies.
- The API exits at startup if MariaDB is unreachable (`apps/api/src/server.ts`). Start Docker first.
- Demo user: `demo@wattnexa.com` / `WattNexa@123`; Swagger at `/docs`; readiness at `/health/ready`.
- Workspace packages export raw TypeScript (`main`/`exports` → `src/index.ts`). If you add one, wire it into `apps/api/tsup.config.ts` (`noExternal` covers `@wattnexa/*`), `apps/web/vite.config.ts` aliases and `apps/web/tsconfig.json` paths.

## Development Notes

- **No CI/CD exists** and none should be added. Frontend deploys to Vercel from root `vercel.json`; API is a long-lived Node process.
- **Vitest**: API config expects `tests/**/*.test.ts` but that directory doesn't exist — run suites individually.
- **Lint**: `pnpm lint` fails; no workspace defines a `lint` script and no ESLint config exists. Don't add one unless asked.
- **Database**: `pnpm db:migrate` creates the database if missing (drizzle-kit alone does not).
- **Seeded/simulated rows** always stored with `source='simulated'`.
- **MQTT**: Implemented but not tested against physical hardware; simulator is the only verified data source.