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
| `DELETE /v1/account` | person | Erases the account (design 14.7): devices revoked, email, codes, sessions and memberships erased. `409 device_enrolled` while a phone of the account is still enrolled and may hold scans to upload |
| `POST /v1/gate/batches` | any device | Uploads 1 to 100 offline operations to `redemption.apply_batch`. Always `200` with one result per operation; revoked and expired devices may upload too (I6) |
| `POST /v1/gate/sign-out` | device | Signs the device out for good |
| `GET /v1/events/:slug` | anyone | An event on sale: public ticket types, price, service charge per ticket, coarse availability, current legal versions. Cached 5 s |
| `POST /v1/orders` | anyone, with `Idempotency-Key` | Holds the tickets (30 min), places the order with a unique amount and a payment code, records the consents. Returns the order's token (`pro_…`), the code, the exact amount and the SINPE number. The same key returns the same order and token (ADR 0033) |
| `GET /v1/orders/current` | order token | The order's status, for the payment screen's polling |
| `GET /v1/wallet` | order token | The order's tickets with their certificates, signed now, and the server key ring (ADR 0030, 0035) |
| `POST /v1/wallet/bind` | order token | Binds the order's unbound tickets to the device key; with a recovery token, rebinds them (ADR 0032, 0036) |
| `POST /v1/wallet/recovery`, `POST /v1/wallet/recovery/verify` | anyone | A code to the order's email, then one recovery token per paid order (ADR 0036). Phone only: `422` |
| `POST /v1/buyer/erasure/code`, `POST /v1/buyer/erasure` | anyone | A buyer's erasure by email code; `409 open_orders` while an order is open or a ticket's event has not ended (ADR 0037) |
| `POST /v1/admin/payments/notices` | administrator | A bank notice typed by hand, recorded once (I4) and reconciled (ADR 0034) |

Organizers send their organization in `X-Org-Id`; `identity.set_actor` checks the membership.

The public site calls `/v1/auth/*`, `/v1/account` and `/v1/buyer/*` from the browser for `/eliminar-datos`; only the origins in `ALLOWED_ORIGINS` may (CORS). The app calls `/v1/events/*`, `/v1/orders` and `/v1/wallet`; only the origins in `APP_ORIGINS` may.

## Tokens and codes

- Bearer tokens are 32 random bytes after a prefix: `pru_` for a person's session, `prd_` for a gate device. The database keeps only their SHA-256.
- Sign-in codes (six digits) and staff codes (the ten-character human code format of ADR 0015) are stored as an HMAC-SHA256 keyed with `SIGN_IN_PEPPER`, so a leaked table cannot be brute-forced offline.
- A revoked or expired device keeps a drain-only session for 30 days, so nothing it recorded offline is lost (invariant I6).

## Ports

| Port | Adapters |
|---|---|
| `MailSender` (`src/ports/mail.ts`) | `gmail` (Gmail API as a Google Workspace mailbox, service account with domain-wide delegation, ADR 0028); `ses` (Amazon SES API v2, SigV4 with `aws4fetch`); `log`, which prints to the console and refuses to run anywhere but localhost |
| `PaymentProvider` (`src/ports/payments.ts`, from `@passripple/contracts`) | `manual`: a notice typed by an administrator. Bank parsers arrive with real anonymized notices (ADR 0034) |
| `ContactChannel` (`src/ports/contact.ts`) | `email`, through `MailSender`. A phone channel is an open decision (ADR 0036) |
| `IntegrityVerifier` (`src/ports/integrity.ts`) | `unverified`: records whether the phone sent a Play Integrity or App Attest token. A signal, never a block |

## Running it locally

```bash
pnpm db:up            # local database (Docker)
pnpm db:migrate
pnpm db:api-login     # once: lets passripple_api log in to the local database
pnpm dev:api          # wrangler dev on http://localhost:8787
```

For a gate to try, seed the development event (`pnpm dev:fixtures seed`) and put the `SERVER_PUBLIC_KEYS` line it prints in `.dev.vars`. `pnpm dev:fixtures qr <n>` prints a QR valid now for fixture ticket `n`; set `DB_CONTAINER=passripple-db` if `psql` is not on PATH.

The fixtures stay in the local database, and the pgTAP suite expects one without them: run `pnpm db:down` and `pnpm db:up` before `pnpm db:test`.

The route to `api.passripple.com` makes `wrangler dev` present that host to the Worker, and the console mailer refuses it. Run it with `--local-upstream localhost:8787` to see sign-in and recovery codes in the console.

`wrangler dev` connects to the local database through the Hyperdrive binding's `localConnectionString`. Secrets come from `.dev.vars` (never committed), copied from `.dev.vars.example`.

## Configuration

`wrangler.jsonc` holds no secret. The Hyperdrive id is that of `passripple-db` (see `db/README.md`). Secrets are set with `wrangler secret put <NAME>`: `SIGN_IN_PEPPER`, `SERVER_PUBLIC_KEYS`, `ALLOWED_ORIGINS` (`https://passripple.com`), `MAIL_PROVIDER` (`gmail`), `MAIL_FROM_ADDRESS`, `MAIL_FROM_NAME`, `GMAIL_CLIENT_EMAIL` and `GMAIL_PRIVATE_KEY` (from the service account's JSON key), and `GMAIL_SENDER_USER` when the sender is an alias. For the checkout and wallet (Phase 3): `SERVER_SIGNING_KEY` and `SERVER_SIGNING_KEY_ID` (ADR 0035; the production key is not decided yet), `APP_ORIGINS`, `FEE_SCHEDULE`, `SINPE_NUMBER` and `UNIQUE_AMOUNT_MAX_OFFSET_CRC` (ADR 0031, 0033). Fee figures and the SINPE number are business data and are never committed. With `MAIL_PROVIDER=ses` instead: `SES_REGION`, `SES_ACCESS_KEY_ID` and `SES_SECRET_ACCESS_KEY`.

The Worker answers only on `api.passripple.com`, a custom domain like the site's: `workers_dev` and `preview_urls` are off (ADR 0026). The Gmail service account may only use the `gmail.send` scope, granted by domain-wide delegation in the Workspace admin console (ADR 0028).

## Deploy

From the repository root, always with `--config` and a dry run first (ADR 0026): the dry run must show only the `HYPERDRIVE` binding.

```bash
pnpm --filter @passripple/worker-api exec wrangler deploy --config wrangler.jsonc --dry-run
pnpm --filter @passripple/worker-api exec wrangler deploy --config wrangler.jsonc
```

## Depends on

- `@passripple/contracts`
- `@passripple/crypto`
- `@passripple/manifest`, `@passripple/pricing`
- `hono`, `postgres`, `zod`, `aws4fetch`; `wrangler` and `@cloudflare/workers-types` for development

Apps and workers are composition roots: they may depend on any core package or module, never on another app or worker.
