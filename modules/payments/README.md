# @passripple/payments

**Kind:** module · **Level:** 3 (transactional)

## Responsibility

Payment reconciliation and idempotent confirmation behind the `PaymentProvider` port. SINPE collection first, a card provider later.

## Owns

The `payments` database schema. No other module writes to it (rule R1).

- `payments.bank_notices`: parsed bank notices, unique by source and reference (invariant I4). Only their status changes (`received` → `applied`, `unmatched` or `surplus`; `unmatched` → `applied` or `surplus`), and none is deleted. The payer's description is stored as untrusted text and never interpreted. Only administrators read them.
- `payments.payments`: append-only confirmed payments, at most one per notice and one per order (I4).

The API never writes these tables. It calls, as the system actor:

| Function | What |
|---|---|
| `payments.record_notice(source, reference, amount, description, payer_name, payer_phone, raw_sha256)` | Records a notice. The same notice again returns the same id; the same reference with different content is an error |
| `payments.confirm(notice, order)` | Turns the notice into the order's payment and marks the order paid. Returns `paid`, `refund_due`, `already_confirmed`, `surplus`, `amount_mismatch` or `unmatched`; confirming twice never creates a second payment |

Matching a notice to its order (by payment code and amount) is part of reconciliation, in Phase 3.

- `payments.outbox`: the domain events this module emitted, published by the relay in `workers/jobs` (ADR 0029).

## Depends on

- `@passripple/contracts`
- `@passripple/bank-parsers`
- `@passripple/orders`

## Emits

- `payment.succeeded`, when `payments.confirm` returns `paid`, through `payments.outbox`

## Guarantees

- Invariant I4 (see [`docs/architecture.md`](../../docs/architecture.md#2-invariants))

## Does not

Issue tickets or move money.

## Public API

Everything other packages may use is exported from `src/index.ts`. Deep imports are not allowed.
