# Jobs

Scheduled tasks and the queue consumer: delivery of domain events between modules, ticket issuing after payment, and the expiry of holds and orders. Later: emails, database warm-up on event days, page rendering and payout reminders.

**Kind:** worker

## What it runs

| Trigger | What |
|---|---|
| Cron, every minute | The relay: publishes each module's outbox to the queue (`src/relay.ts`), then expires holds and orders |
| Queue `passripple-domain-events` | The consumer: validates each envelope and hands the event to the module that handles it (`src/consumer.ts`) |

## Domain event delivery (ADR 0029)

- Each emitting module writes its events to its own outbox (`orders.outbox`, `payments.outbox`, `ticketing.outbox`) in the same transaction as the change.
- The relay, in one transaction per batch: `<schema>.outbox_claim(100)` (locked, skipping rows another relay holds), `sendBatch` to the queue, `<schema>.outbox_mark_published(ids)`. A failed send rolls back. Delivery is at least once.
- The envelope is `DomainEventEnvelope` from `@passripple/contracts`: `{ id, source, event }`. The consumer validates it with Zod.
- Consumers are idempotent by the envelope's id, recorded in the consuming module's inbox in the same transaction as the effect. A message that fails is retried with backoff; after five attempts it goes to `passripple-domain-events-dlq`.

| Event | Emitted by | Consumed here |
|---|---|---|
| `order.paid` | `orders.mark_paid` | Reads the order's lines with `orders.paid_order_lines`, draws a fallback code per ticket and calls `ticketing.issue_order` |
| `order.expired` | `orders.expire_orders` | Not yet |
| `payment.succeeded` | `payments.confirm` | Not yet (settlement, Phase 4) |
| `ticket.issued` | `ticketing.issue_order` | Not yet (notifications) |

### Adding an event

1. Its type in `packages/contracts/src/domain-events.ts` and its schema in `domain-event-envelope.ts`.
2. In a new migration of the emitting module, a call to `<schema>.emit(payload)` in the function that makes the change. A module without an outbox copies `orders`' (`0003_outbox.sql`) and joins `EVENT_SOURCES` and the relay's two switches.
3. For a consumer: an inbox in its schema, a handler that records the envelope's id, and a case in `handle` (`src/consumer.ts`).

## Running it locally

```bash
pnpm db:up && pnpm db:migrate && pnpm db:api-login
pnpm dev:jobs        # wrangler dev --test-scheduled, on http://localhost:8788
curl "http://localhost:8788/__scheduled?cron=*+*+*+*+*"   # runs the cron once
```

`wrangler dev` simulates the queue (producer and consumer in this Worker) and connects to the local database through the Hyperdrive binding's `localConnectionString`.

## Configuration

`wrangler.jsonc` holds no secret. Before the first deploy, create in the account the queues `passripple-domain-events` and `passripple-domain-events-dlq` and a Hyperdrive configuration, and put its id in place of the placeholder. Deploy only from the repository root with `--config` and a dry run first (ADR 0026).

## Depends on

- `@passripple/contracts`, `@passripple/crypto`
- `postgres`; `wrangler` and `@cloudflare/workers-types` for development

Apps and workers are composition roots: they may depend on any core package or module, never on another app or worker.
