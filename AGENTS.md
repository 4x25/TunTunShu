# AGENTS.md — TunTunShu (囤囤鼠)

## Stack

- **Runtime**: Deno (Fresh 2, FS file routing)
- **Frontend**: Preact + TailwindCSS 4 + DaisyUI (Vite HMR in dev, CSR only — no
  SSR)
- **Database**: PostgreSQL via `npm:postgres` raw driver (no ORM/migrations yet)
- **No**: DrizzleORM, Prisma, Hono, React, ShadcnUI

## Commands

```bash
deno task check          # fmt --check + lint + typecheck (run before committing)
deno task dev            # Vite HMR dev server
deno task build          # Vite production build → _fresh/
deno task start          # deno serve -A _fresh/server.js
deno task update         # Upgrade Fresh version
```

`deno fmt` (without `--check`) auto-fixes formatting issues. Always run
`deno task check` after changes.

## Required Environment Variables

| Env            | Purpose                                  | Default         |
| -------------- | ---------------------------------------- | --------------- |
| `AUTH_KEY`     | Admin login password & default proxy key | **required**    |
| `DATABASE_DSN` | PostgreSQL connection string             | **required**    |
| `PORT`         | Listen port                              | `4025`          |
| `HOST`         | Listen host                              | `0.0.0.0`       |
| `TZ`           | Timezone                                 | `Asia/Shanghai` |

`DATABASE_DSN` is mandatory. If missing, the app throws on startup. SQLite
fallback is planned for Docker but not implemented yet.

## Architecture

```
routes/             # Fresh 2 FS-routed handlers (routes/api/* + routes/v1/*)
  api/              # Admin API — requires AUTH_KEY via Bearer token
  v1/               # OpenAI-compatible proxy (SSE streaming + token-usage logging) — requires AUTH_KEY or proxy_auth_keys
services/           # Business logic (called by routes)
adapters/           # new-api upstream HTTP adapter
db/client.ts        # postgres singleton (connect_timeout: 10s)
db/init.ts          # CREATE TABLE IF NOT EXISTS (runs on startup)
lib/                # auth, env, mask, response helpers
types/              # TypeScript type definitions and enums
jobs/               # Background jobs (checkin/sync/health-check/log-cleanup), wired to Deno.cron in main.ts
```

### Auth Boundaries

- `/api/*` routes: `requireAdmin()` checks `Authorization: Bearer <AUTH_KEY>`
  only
- `/v1/*` routes: checks token against `AUTH_KEY` +
  `system_settings.proxy_auth_keys` (multi-line config)

### Database Conventions

- Table/column names: `snake_case` in SQL, `camelCase` in TypeScript
- IDs: `bigserial` / `bigint` primary keys, typed as `number` in TS
- No foreign key constraints — ID references stored as plain `bigint`
- Cascade deletes happen in app code (service layer), not in schema

### new-api Adapter

User-level endpoints require both headers:

```http
Authorization: Bearer <accessToken>
new-api-user: <userId>
```

API-key-level endpoints require only:

```http
Authorization: Bearer <apiKey>
```

Token discovery flow:

1. `GET /api/token/?p=1&size=20` (user auth) → get token IDs
2. `POST /api/token/:id/key` (user auth) → get plaintext API key

### Scheduled Jobs (Deno.cron)

- Registered at module top-level in `main.ts`; needs `unstable: ["cron"]` and
  the `deno.unstable` lib in `deno.json`.
- **Schedules are interpreted as UTC** (Deno.cron has no timezone param);
  day-of-week is 1-7. Config keys are `cron_*` in `defaultSettings` /
  `system_settings`.
- Schedules are read once at startup — **changing cron settings requires a
  restart**.
- Jobs only process `enabled` records; the same functions back the manual
  `POST /api/tasks/*` endpoints.
- `account_api_key_sync` (discovering new upstream keys) stays manual-only, not
  scheduled.

### Entity Relationships

```
Site 1:N Account
Account 1:N ApiKey
ApiKey 1:N UpstreamModel
Model 1:N UpstreamModel
```

## State

- Backend skeleton complete, `deno task check` passes
- `/v1/chat/completions`: SSE streaming, token-usage logging, OpenAI-format
  errors, random routing with retry
- Scheduled jobs wired to Deno.cron (checkin / quota-sync / model-sync /
  health-check / log-cleanup)
- Frontend not built yet
- v0.1.0 branch targets Deno Deploy first, Docker later
- Tests: `lib/sse_test.ts` (SSE usage sniffing); broader suite still TODO
