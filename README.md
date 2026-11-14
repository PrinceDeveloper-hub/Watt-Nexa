# WattNexa

**Know exactly where your electricity bill is going.**

An IoT electricity-monitoring and smart-energy platform: a clamp-on sensor feeds an ESP32, readings stream into an Express API, and the dashboard turns kWh into the money you actually pay.

---

## Stack

| Layer | Technology |
| --- | --- |
| Frontend | React 18, TypeScript, Vite, Tailwind CSS, Radix UI primitives, Recharts, TanStack Query, React Hook Form + Zod, React Router, Framer Motion |
| Backend | Node.js, Express 4, TypeScript, Socket.IO, Zod, JWT in HTTP-only cookies, bcrypt |
| Data | MariaDB 11, Drizzle ORM + Drizzle Kit migrations |
| IoT | MQTT (optional broker) and an HTTP telemetry endpoint, per-device bearer tokens |
| Ops | Docker Compose, Pino logging, Swagger UI, Vitest |

pnpm monorepo: `apps/web`, `apps/api`, `packages/{config,types,shared,database}`.

---

## Quick start

```bash
# 1. Install
pnpm install

# 2. Environment
cp .env.example .env      # already present in a fresh clone of this workspace

# 3. Database (Docker Desktop must be running)
docker compose up -d mariadb

# 4. Schema + demo data
pnpm db:migrate
pnpm db:seed

# 5. Run API + web together
pnpm dev
```

- Web: <http://localhost:5173>
- API: <http://localhost:4000>
- API docs: <http://localhost:4000/docs>

> **Important:** `DATABASE_URL` (or the preferred `DB_HOST`/`DB_PORT`/`DB_USER`/`DB_PASSWORD`/`DB_NAME` variables) must match your MariaDB instance.
> If you see "Database unreachable", check the host and port in `.env` first.

### Windows notes

Use Git Bash (or WSL) for the commands above. `docker compose` requires Docker Desktop to be running.
The API loads the root `.env` automatically, so run `pnpm` from the repository root.

### Demo accounts

| Role | Email | Password |
| --- | --- | --- |
| User | `demo@wattnexa.com` | `WattNexa@123` |
| Admin | `admin@wattnexa.com` | `WattNexa@123` |
| Support | `support@wattnexa.com` | `WattNexa@123` |
| Super admin | `super@wattnexa.com` | `WattNexa@123` |

Seeded pairing code: `WNX-PAIR-4F2A`.

---

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | API and web dev servers in parallel |
| `pnpm build` | Build both apps |
| `pnpm typecheck` | TypeScript across all workspaces |
| `pnpm test` | Vitest suites |
| `pnpm db:generate` | Generate a Drizzle migration after schema edits |
| `pnpm db:migrate` | Apply migrations (creates the database if missing) |
| `pnpm db:seed` | Insert plans, demo household, 30 days of simulated readings |
| `pnpm db:reset` | Drop, migrate and reseed (development only) |
| `pnpm simulate` | Publish simulated readings every 5s |
| `pnpm docker:up` / `pnpm docker:down` | MariaDB (and Mosquitto) |

---

## Device integration

Pairing issues a **per-device bearer token** (shown once, only its SHA-256 is stored).
Send readings with either transport:

```bash
curl -X POST http://localhost:4000/api/v1/telemetry \
  -H "Authorization: Bearer wnx_dev_..." \
  -H "Content-Type: application/json" \
  -d '{
    "voltage": 230.1, "current": 4.2, "active_power": 966.4,
    "power_factor": 0.95, "temperature": 33.2, "frequency": 50.0,
    "signal_strength": -58, "device_status": "online",
    "timestamp": "2026-01-01T10:00:00.000Z"
  }'
```

MQTT topics (prefix defaults to `wattnexa`):

| Topic | Direction |
| --- | --- |
| `<prefix>/devices/<serial>/telemetry` | device → API |
| `<prefix>/devices/<serial>/status` | device → API (use `offline` as the last will) |
| `<prefix>/devices/<serial>/commands` | API → device |

**Only send what the hardware actually measures.** Omit unknown fields — they are stored as `NULL`
and rendered as "unavailable", never zero-filled.

Devices move through `not_configured → connecting → online → offline`, plus `error`. The status is
driven by real traffic: pairing alone never marks a device online, and the 60-second sweep marks a
device offline when telemetry stops. Every transition is written to the device's connection history.

Send a `message_id` with each reading so MQTT QoS 1 redelivery cannot create duplicate rows; the
database enforces it with a unique index.

Full contract, broker ACLs and an ESP32 reference sketch: [docs/HARDWARE.md](docs/HARDWARE.md).
MQTT is implemented but has **not** been tested against physical hardware — the simulator is the
only verified data source so far.

---

## Data honesty rules (enforced in code)

1. Every telemetry row is tagged `source = 'hardware' | 'simulated'`; the UI labels simulated data.
2. Unavailable measurements are `NULL`, not `0`.
3. Bill figures are labelled estimates; the provider's bill stays authoritative.
4. No savings are claimed without enough history to compute a comparison.
5. Sandbox plan changes create an **open** invoice, never a fake "paid" payment.
6. A single whole-house CT sensor does not identify individual appliances — appliance figures are manual estimates.

---

## WattBot

The in-app energy assistant answers from the authenticated household's stored readings and tariff —
it never receives database access, only a pre-computed fact sheet, and it refuses to invent readings,
rates or savings.

```dotenv
WATTBOT_PROVIDER=none     # none | openai | anthropic — keys stay on the backend
```

Messages are metered per plan from `subscription_plans.wattbot_messages_per_day` (Free 0 — not
included, Plus 20/day, Pro 100/day) and enforced server-side before any provider call, with the rollover
at 00:00 UTC.

With no provider configured (the default), WattBot still works: replies are computed deterministically
from your data and the UI labels the mode. Streaming runs over Server-Sent Events, conversations are
persisted per user, and provider timeouts/rate limits fall back to the same grounded answer.

Full configuration, safety model and current limits: [docs/WATTBOT.md](docs/WATTBOT.md).

## Deployment

Three independent targets — see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for the full runbook.

| Part | Target | Deployment |
| --- | --- | --- |
| Frontend | Vercel | Automatic via Git integration (`vercel.json` at repo root) |
| Backend | Persistent Node host / VPS | Manual build + service restart |
| Database | Managed MariaDB | Manual Drizzle migrations |

There is **no custom CI/CD**: no GitHub Actions, no deployment scripts. Vercel builds the frontend; the API and migrations are released by hand.

**Vercel setup:** import the repo, keep the **Root Directory at the repository root** (not `apps/web`,
because workspace packages install from the root), and set `VITE_API_URL` / `VITE_SOCKET_URL` to the
public API origin. `vercel.json` supplies the build command, `apps/web/dist` output and SPA fallback.

**Backend release:**

```bash
pnpm install --frozen-lockfile
pnpm --filter @wattnexa/api build
NODE_ENV=production node apps/api/dist/server.js   # behind HTTPS, long-lived
```

**Cross-site cookies:** with the SPA on `*.vercel.app` and the API on its own domain, set
`COOKIE_SAME_SITE=none` (forces `Secure`) — otherwise browsers drop the session cookies. Keep `lax`
when both are served from one site. Add the Vercel origin (and `https://*.vercel.app` for previews)
to `CORS_ORIGINS`.

Health checks: `GET /health` (liveness) and `GET /health/ready` (`503` when MariaDB is down).

The backend must not be deployed as serverless functions: it holds WebSocket connections and an MQTT
client.

## Project structure

```
apps/
  api/         Express API, sockets, MQTT, simulator, scheduler
  web/         React app (public site + dashboard + admin workspace)
packages/
  config/      Zod-validated environment
  types/       Shared DTO/domain types
  shared/      Tariff math, aggregation, formatters, Zod schemas
  database/    Drizzle schema (30 tables), migrations, seed
docker/        Mosquitto development config
```

## Known limitations

- Payments run in sandbox mode; no real gateway is wired in.
- Email falls back to a development outbox (`/api/v1/dev/outbox`) when SMTP is unset.
- Support tickets, blog CMS and automation execution history exist in the schema but have no UI yet.
- Excel export is not implemented (CSV and PDF are).
- The production web bundle is a single chunk; route-level code splitting is still to do.
