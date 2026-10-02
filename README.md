# PassRipple

**Fraud-proof event ticketing for Costa Rica.** Device-bound QR tickets, offline-first gate validation, SINPE Móvil payments and verifiable payouts to organizers.

> **Status:** pre-alpha. Phase 0 is complete: the database enforces invariants I1–I5 and Row Level Security, and runs on Neon. Phase 1 is next.

---

## Why PassRipple

Organizers of mass events in Costa Rica sell paper tickets that get reprinted and resold as originals. At the gate, the copy looks exactly like the real one, and the fraud is only discovered when more people are inside than tickets were sold.

PassRipple starts from one idea:

> **The paper is not the ticket. The database record is.**

Every ticket is a unique record that is redeemed on its first scan, and its credential lives on the buyer's phone. Copying a ticket becomes pointless: a screenshot expires in seconds, and a second scan is rejected.

**Mission:** every person who buys a ticket gets in knowing it is real, and every organizer knows at any moment how many tickets were sold, how many people got in, and how much money is theirs, from a rural rodeo ring to a stadium.

## How it works

| | |
|---|---|
| **Three taps to buy** | Open the event link, tap *Buy*, enter an email or phone, tap *Accept and pay with SINPE*. No account, no password. |
| **Device-bound credentials** | Each ticket is bound to a non-extractable key on the buyer's phone. The QR is re-signed every 30 seconds, so screenshots expire before they reach the gate. |
| **Offline-first gates** | Gate devices verify tickets locally with public keys only. A gate keeps working all night with no signal and syncs when it can. |
| **Verifiable payouts** | Every colón is recorded in an append-only ledger. Organizers see each payment live and confirm every payout. |
| **Built for oversight** | Live attendance against the permitted capacity, and an automatic post-event report for the municipality. |

## Core invariants

The rules the system must never break. They live in the database and in the cryptography, not in application code, and each one has a test that tries to violate it.

| # | Invariant |
|---|---|
| I1 | A public ticket is redeemed exactly once. |
| I2 | Committed tickets never exceed the event's permitted capacity. |
| I3 | Complimentary tickets never exceed the event's declared quota. |
| I4 | No payment is processed twice. |
| I5 | A sale's fee is frozen at the moment of the sale. |
| I6 | No operation recorded on a gate device is lost or rejected on sync. |
| I7 | No gate device can forge a valid credential. |
| I8 | No third-party script runs where the buyer's keys or personal data live. |
| I9 | An organizer's payout never exceeds what their event collected, minus fees and refunds. |

## Architecture

A **modular monolith**: domain modules with enforced boundaries, each owning its own database schema. The full design is in [`docs/architecture.md`](docs/architecture.md), and the reasons behind each decision are in [`docs/adr/`](docs/adr/).

> **Note:** `docs/` is kept private and is not part of this repository, so links to it do not resolve here. To work on the code, use this file and each package's `README.md`, which hold the commands and the rules.

| Layer | Technology |
|---|---|
| Language | TypeScript everywhere; SQL for invariants |
| Database | PostgreSQL on Neon, with Row Level Security |
| API and jobs | Cloudflare Workers, Hyperdrive, Queues, Cron Triggers |
| Web (checkout, wallet, dashboard) | Vite + React PWA on Cloudflare Pages |
| Gate app | Expo (React Native) with encrypted SQLite |
| Cryptography | Ed25519 and HMAC via `@noble/curves` and `@noble/hashes` |
| Tooling | pnpm workspaces, Biome, Vitest, pgTAP |

```
packages/            Core: pure, domain-agnostic libraries (level 0)
  contracts/         Shared schemas, types, domain events, QR format
  crypto/            Certificates, device-bound credentials, human codes
  pricing/           Fee calculation
  tax/               Municipal tax calculation
  bank-parsers/      Deterministic bank payment notice parsers
  outbox/            Durable offline queue

modules/             Domain modules (levels 1-4), each owning a schema
  identity/  jurisdictions/  events/  catalog/  privacy/           level 1
  inventory/  ticketing/  courtesy/  staff/                        level 2
  orders/  payments/  redemption/  manifest/  door-sales/          level 3
  settlement/  reporting/  notifications/  audit/                  level 4
  municipal/  seo/  analytics/  invoicing/

apps/                User-facing applications
  app/               Checkout, wallet, dashboard, municipal portal, admin
  site/              Public pages: events, organizers, legal
  scanner/           Gate app: validation, door sales, supervisor, inspector
  coordinator/       Optional LAN server for multi-gate events

workers/             Cloudflare Workers
  api/               HTTP API and composition root
  payments-in/       Bank payment notice receiver
  jobs/              Queues and scheduled tasks

db/                  Local database image, bootstrap SQL and its tests
scripts/             Boundary check, migrations and database tests
tools/sms-forwarder/ Android app that forwards bank SMS notices
docs/                Architecture, hardening checklist, decision records (private, not in Git)
```

Each module's `README.md` states what it does, what it owns, what it depends on, and what it must not do.

## Getting started

Requirements: Node.js 22.18 or later, pnpm, Docker, the PostgreSQL client (`psql`) and pre-commit.

```bash
pre-commit install   # scan every commit for secrets
pnpm install

pnpm verify          # lint, type check, module boundaries and unit tests
pnpm test:cov        # Vitest unit tests with coverage

pnpm db:up           # start the local database (Docker)
pnpm db:migrate      # apply migrations in module dependency order
pnpm db:test         # run every pgTAP test
pnpm db:down         # stop the database and delete its data
```

## Security

PassRipple handles money and personal data, so security is designed in, not added on:

- Gate devices store **public keys only**. Extracting a gate device's data cannot produce a valid ticket.
- Payments are confirmed **only** by the bank's notice, parsed deterministically. Screenshots never approve a payment, and no AI model decides one.
- The system **cannot move money**. It calculates, records and reminds; transfers are made by a person.
- The checkout and wallet run on a separate origin with a strict CSP and **no third-party scripts**.
- Secrets never live in this repository. Every commit and the full history are scanned by gitleaks, every change is analyzed by Semgrep with project-specific rules, and Dependabot watches dependencies.
- Every GitHub Action is pinned to a full commit SHA, and downloaded tools are checksum-verified.

Found a vulnerability? Read [`SECURITY.md`](SECURITY.md) and report it privately. Account and repository settings are listed in [`docs/hardening.md`](docs/hardening.md).

## Roadmap

- [x] **Phase 0** — Foundations: schema, Row Level Security, invariants I1–I5 under test, Neon
- [ ] **Phase 1** — Cryptography: device-bound credentials (I7)
- [ ] **Phase 2** — API on Cloudflare Workers with Hyperdrive, single-gate offline validator, Play Store closed testing, iOS build tested in the simulator
- [ ] **Phase 3** — Three-tap checkout, SINPE collection and reconciliation
- [ ] **Phase 4** — Dashboard, ledger and verifiable payouts (I9)
- [ ] **Phase 5** — Public site, SEO and analytics
- [ ] **Phase 6** — Load testing and waiting room
- [ ] **Phase 7** — Age ratings, complimentary tickets, door sales
- [ ] **Phase 8** — Municipal oversight portal
- [ ] **Phase 9** — Multi-gate events
- [ ] **Phase 10** — Cards, e-invoicing

## License

Proprietary. Copyright © 2026 Jefferson Abarca. All rights reserved.

This repository is private. See [`LICENSE`](LICENSE): no license is granted to use, copy, modify or distribute this code.

---

Made in Costa Rica 🇨🇷
