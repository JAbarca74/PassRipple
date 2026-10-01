# @passwave/payments

**Kind:** module · **Level:** 3 (transactional)

## Responsibility

Payment reconciliation and idempotent confirmation behind the `PaymentProvider` port. SINPE collection first, a card provider later.

## Owns

The `payments` database schema. No other module writes to it (rule R1).

## Depends on

- `@passwave/contracts`
- `@passwave/bank-parsers`
- `@passwave/orders`

## Emits

- `payment.succeeded`

## Guarantees

- Invariant I4 (see [`docs/architecture.md`](../../docs/architecture.md#2-invariants))

## Does not

Issue tickets or move money.

## Public API

Everything other packages may use is exported from `src/index.ts`. Deep imports are not allowed.
