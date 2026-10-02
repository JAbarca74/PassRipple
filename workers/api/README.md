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
| `POST /v1/auth/sign-in` | anyone | Emails a six-digit code (10 minutes). Always `202`; five codes per address in 15 minutes, then `429` |
| `POST /v1/auth/verify` | anyone | Exchanges the code for a person's session token (`pru_…`, 24 hours). Five wrong attempts kill the code |
| `POST /v1/auth/sign-out` | person | Ends the session |
| `POST /v1/staff/codes` | organizer | Creates a staff code for an event, role, zone and window; the code is shown only in this response |
| `GET /v1/staff/codes?eventId=` | organizer | The event's staff codes, without the codes themselves |
| `POST /v1/staff/codes/:id/revoke` | organizer | Nobody else enrolls with the code |
| `POST /v1/staff/devices/:id/revoke` | organizer | The device becomes drain-only: it may upload, not validate |
| `POST /v1/staff/enroll` | person, as staff | Enrolls a phone with a staff code; returns the device token (`prd_…`) |
| `GET /v1/gate/session` | device | The device's status (`active`, `revoked`, `expired`) and the server clock |
| `GET /v1/gate/manifest[?since=cursor]` | active device | The event's gate manifest (`@passripple/contracts`), whole or only what changed since a cursor |
| `POST /v1/gate/sign-out` | device | Signs the device out for good |

Organizers send their organization in `X-Org-Id`; `identity.set_actor` checks the membership.

## Tokens and codes

- Bearer tokens are 32 random bytes after a prefix: `pru_` for a person's session, `prd_` for a gate device. The database keeps only their SHA-256.
- Sign-in codes (six digits) and staff codes (the ten-character human code format of ADR 0015) are stored as an HMAC-SHA256 keyed with `SIGN_IN_PEPPER`, so a leaked table cannot be brute-forced offline.
- A revoked or expired device keeps a drain-only session for 30 days, so nothing it recorded offline is lost (invariant I6).

## Ports

| Port | Adapters |
|---|---|
| `MailSender` (`src/ports/mail.ts`) | `ses` (Amazon SES API v2, SigV4 with `aws4fetch`); `log`, which prints to the console and refuses to run anywhere but localhost |
| `IntegrityVerifier` (`src/ports/integrity.ts`) | `unverified`: records whether the phone sent a Play Integrity or App Attest token. A signal, never a block |

## Running it locally

```bash
pnpm db:up            # local database (Docker)
pnpm db:migrate
pnpm db:api-login     # once: lets passripple_api log in to the local database
pnpm dev:api          # wrangler dev on http://localhost:8787
```

For a gate to try, seed the development event (`pnpm dev:fixtures seed`) and put the `SERVER_PUBLIC_KEYS` line it prints in `.dev.vars`. `pnpm dev:fixtures qr <n>` prints a QR valid now for fixture ticket `n`; set `DB_CONTAINER=passripple-db` if `psql` is not on PATH.

`wrangler dev` connects to the local database through the Hyperdrive binding's `localConnectionString`. Secrets come from `.dev.vars` (never committed), copied from `.dev.vars.example`.

## Configuration

`wrangler.jsonc` holds no secret. The Hyperdrive id is a placeholder until the Cloudflare account exists: replace it with the id printed by `wrangler hyperdrive create` (see `db/README.md`). Secrets are set with `wrangler secret put <NAME>`.

## Depends on

- `@passripple/contracts`
- `@passripple/crypto`
- `hono`, `postgres`, `zod`, `aws4fetch`; `wrangler` and `@cloudflare/workers-types` for development

Apps and workers are composition roots: they may depend on any core package or module, never on another app or worker.
