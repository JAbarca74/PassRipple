# API

HTTP API on Cloudflare Workers: gate devices, staff enrollment, and later checkout, wallet and dashboard. It is the composition root that wires modules together and puts every external provider behind a port (rule R5).

**Kind:** worker

## How it reaches the database

- Through Cloudflare Hyperdrive, as `passripple_api`, with [Postgres.js](https://github.com/porsager/postgres). Queries are tagged templates, so every value is a parameter.
- One transaction per unit of work. Its first statement is `identity.set_actor(actor_id, actor_role, org_id)`, so Row Level Security applies to everything after it (ADR 0009). The settings are transaction-local, which is what Hyperdrive's transaction pooling needs.
- A connection is opened lazily per request and closed after the response (`src/db.ts`).

## Layout

| Path | What it holds |
|---|---|
| `src/index.ts` | Entry point: the app with its real services |
| `src/app.ts` | The Hono app: middleware, routes, error handling |
| `src/db.ts` | `connect` and `Database.transaction(actor, work)` |
| `src/errors.ts` | `ApiError` and the mapping of SQLSTATE codes to HTTP statuses |
| `src/env.ts` | Bindings, variables and secrets the Worker receives |
| `src/routes/` | One file per group of routes |

Every response carries the server's clock in `X-Server-Time` (milliseconds), which gate devices use to correct their own.

## Routes

| Method and path | Who | What |
|---|---|---|
| `GET /v1/health` | anyone | The Worker is up |
| `GET /v1/health/db` | anyone | The Worker reaches the database through Hyperdrive |

## Running it locally

```bash
pnpm db:up            # local database (Docker)
pnpm db:migrate
pnpm db:api-login     # once: lets passripple_api log in to the local database
pnpm dev:api          # wrangler dev on http://localhost:8787
```

`wrangler dev` connects to the local database through the Hyperdrive binding's `localConnectionString`. Secrets come from `.dev.vars` (never committed), copied from `.dev.vars.example`.

## Configuration

`wrangler.jsonc` holds no secret. The Hyperdrive id is a placeholder until the Cloudflare account exists: replace it with the id printed by `wrangler hyperdrive create` (see `db/README.md`). Secrets are set with `wrangler secret put <NAME>`.

## Depends on

- `@passripple/contracts`
- `hono`, `postgres`; `wrangler` and `@cloudflare/workers-types` for development

Apps and workers are composition roots: they may depend on any core package or module, never on another app or worker.
