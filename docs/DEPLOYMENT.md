# Deployment

WattNexa ships in three parts, each deployed independently:

| Part | Where | How it deploys |
| --- | --- | --- |
| Frontend (`apps/web`) | Vercel | Automatic, via the Vercel ↔ GitHub integration on every push |
| Backend (`apps/api`) | Persistent Node.js host / VPS | Manual: build, upload/pull, restart the service |
| Database | Managed MariaDB | Manual migrations run from an operator machine |

There is **no custom CI/CD**. No GitHub Actions workflows, deployment scripts or pipeline
configuration exist in this repository, and none should be added. Vercel handles the frontend;
backend releases and database migrations are deliberate manual steps.

```
Browser ──HTTPS──► Vercel (React SPA)  ──HTTPS + WSS──►  api.example.com (Express)
                                                            │        │
                                                     MariaDB (TLS)   MQTT broker
```

---

## 1. Frontend — Vercel

### Repository setup

1. Push the repository to GitHub.
2. In Vercel: **Add New → Project → Import** the repository.
3. **Root Directory:** leave it as the repository root (`./`). Do **not** point it at `apps/web`.
   The workspace packages are referenced with `workspace:*`, so dependency installation must run at
   the monorepo root.
4. Framework preset: **Vite**. Build and output settings come from `vercel.json` at the repo root:

   | Setting | Value |
   | --- | --- |
   | Install command | `pnpm install --frozen-lockfile` |
   | Build command | `pnpm --filter @wattnexa/web build` |
   | Output directory | `apps/web/dist` |

5. Node version: **20.x** (Project Settings → General).

### Environment variables (Production **and** Preview)

| Variable | Example | Notes |
| --- | --- | --- |
| `VITE_API_URL` | `https://api.example.com` | Baked into the bundle at build time |
| `VITE_SOCKET_URL` | `https://api.example.com` | Same host as the API; Socket.IO shares the origin |

`VITE_*` values are compiled into the static bundle. Changing them requires a new deployment.

### SPA routing

`vercel.json` contains the fallback rewrite:

```json
{ "source": "/((?!assets/).*)", "destination": "/index.html" }
```

Client-side routes (`/app/devices`, `/pricing`, …) therefore resolve on hard refresh and direct
navigation, while hashed assets keep their immutable cache headers.

### Custom domain

Project Settings → Domains → add `app.example.com`. Then add that exact origin to the API's
`CORS_ORIGINS` (see below). Preview deployments use generated `*.vercel.app` hostnames — cover them
with a wildcard entry rather than editing the allow-list per push.

---

## 2. Backend — manual deployment

The Express server holds WebSocket connections and an MQTT client. It must run as a **long-lived
process**; do not deploy it as a serverless function.

### Build and start

```bash
# On the server, inside the repository
pnpm install --frozen-lockfile
pnpm --filter @wattnexa/api build        # tsup → apps/api/dist/server.js
NODE_ENV=production node apps/api/dist/server.js
```

Run with the working directory set to `apps/api` so relative paths such as `uploads/` resolve
predictably.

### Environment variables

```dotenv
NODE_ENV=production
API_PORT=4000
API_URL=https://api.example.com
WEB_URL=https://app.example.com

# Comma-separated. Wildcards allowed for preview deployments.
CORS_ORIGINS=https://app.example.com,https://*.vercel.app

DATABASE_URL=mysql://user:password@db-host:3306/wattnexa?ssl=true
JWT_ACCESS_SECRET=<64+ random chars>
JWT_REFRESH_SECRET=<different 64+ random chars>

# Cross-site cookies (Vercel frontend ↔ API on another domain)
COOKIE_SECURE=true
COOKIE_SAME_SITE=none
```

**Cookie policy matters.** With the SPA on `*.vercel.app` and the API on `api.example.com`, the two
are different *sites*: browsers will discard `SameSite=Lax` cookies on cross-site requests. Set
`COOKIE_SAME_SITE=none` (which forces `Secure`) for that topology. If you instead serve the SPA and
API from one domain (e.g. Vercel rewrite proxy or a shared parent domain), keep `lax`.

### Service supervision

Any process manager works; a systemd unit is the simplest durable option:

```ini
[Unit]
Description=WattNexa API
After=network.target

[Service]
Type=simple
User=wattnexa
WorkingDirectory=/srv/wattnexa/apps/api
EnvironmentFile=/srv/wattnexa/.env
ExecStart=/usr/bin/node dist/server.js
Restart=always
RestartSec=5
# graceful shutdown: SIGTERM closes the HTTP server, sockets and the pool
KillSignal=SIGTERM
TimeoutStopSec=20

[Install]
WantedBy=multi-user.target
```

The server already handles `SIGINT`/`SIGTERM` by stopping the scheduler, closing MQTT, closing the
HTTP server and draining the database pool.

### HTTPS and WebSockets

Terminate TLS at a reverse proxy. Socket.IO needs the WebSocket upgrade forwarded:

```nginx
location /socket.io/ {
    proxy_pass http://127.0.0.1:4000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 600s;
}

location / {
    proxy_pass http://127.0.0.1:4000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

`app.set('trust proxy', 1)` is enabled, so rate limiting and audit logs see the client IP.

### MQTT

Set `MQTT_ENABLED=true` plus `MQTT_URL`, credentials and `MQTT_TOPIC_PREFIX`. The broker must be
reachable **from the API host** (outbound TCP 8883 for TLS). Topic contract:

```
<prefix>/devices/<serial>/telemetry   device → API
<prefix>/devices/<serial>/status      device → API (retained last will supported)
<prefix>/devices/<serial>/commands    API → device
```

Set `MQTT_ENABLED=false` to run without a broker; the API then reports MQTT as disabled and device
commands answer `503` instead of pretending to deliver. Broker credentials live only on the API
host — never in the frontend. Per-device topic ACLs, the payload schema and an ESP32 reference
sketch are in [HARDWARE.md](HARDWARE.md).

### Health checks

| Endpoint | Purpose |
| --- | --- |
| `GET /health` | Liveness — process is up |
| `GET /health/ready` | Readiness — returns `503` when MariaDB is unreachable |

Point the host's health check at `/health/ready` and restart on repeated failure.

---

## 3. Database — managed MariaDB

1. Provision MariaDB 11 (or a compatible managed MySQL/MariaDB) with a private network endpoint.
2. Create a dedicated database and user; grant only what the app needs:

   ```sql
   CREATE DATABASE wattnexa CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   CREATE USER 'wattnexa'@'%' IDENTIFIED BY '<strong-password>';
   GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES ON wattnexa.* TO 'wattnexa'@'%';
   ```

3. Enable TLS on the provider and add `?ssl=true` (or the provider's CA parameter) to `DATABASE_URL`.
4. Set `DATABASE_URL` on the API host — never in the frontend.

### Migrations

Run manually from an operator machine with the production `DATABASE_URL`, **before** starting the
new API build:

```bash
DATABASE_URL='mysql://…' pnpm --filter @wattnexa/database migrate
```

Migrations are additive-forward (Drizzle). Take a backup immediately before applying them.

### Backups and recovery

- Enable the provider's automated daily backups **and** point-in-time recovery where offered.
- Keep a weekly logical dump in object storage as an independent copy.
- **Recovery procedure:** provision a replacement instance → restore the latest dump/PITR snapshot →
  set `DATABASE_URL` on the API host → run `pnpm --filter @wattnexa/database migrate` to confirm the
  schema is current (it should be a no-op) → restart the API → verify `/health/ready`.
- Rotate the database password after any restore that follows a credential compromise, then update
  `DATABASE_URL` and restart.

Never run `pnpm db:reset` against production; it refuses when `NODE_ENV=production`, but treat the
command as local-only regardless.

---

## 4. Production verification checklist

Run before every release, manually:

1. `pnpm --filter @wattnexa/web build` succeeds locally.
2. `pnpm --filter @wattnexa/api build` succeeds and `apps/api/dist/server.js` exists.
3. Every environment variable above is present on both hosts (no defaults relied upon).
4. `curl -i https://api.example.com/health/ready` returns `200`.
5. Migrations applied: `pnpm --filter @wattnexa/database migrate` reports no pending changes.
6. Sign in on the deployed frontend; confirm the `wnx_at` / `wnx_rt` cookies are `Secure`,
   `HttpOnly`, and (for the cross-site topology) `SameSite=None`.
7. A request from the Vercel origin succeeds; a request from an unlisted origin is rejected by CORS.
8. Socket.IO connects under `wss://` and a simulated reading updates the dashboard without refresh.
9. MQTT: publish to `<prefix>/devices/<serial>/telemetry` and see the reading stored, with the
   device flipping to `online` and a `connected` entry in its connection history.
10. `/health` returns `200`; `/docs` loads (disable or protect it publicly if preferred).
11. Dashboard renders, WattBot answers, and a CSV/PDF export downloads.

---

## What deliberately does **not** exist

- No GitHub Actions workflows or CI pipelines.
- No deployment shell scripts checked into the repo.
- No container orchestration or auto-scaling configuration for production (Docker Compose remains a
  local development convenience only).
