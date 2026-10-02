# @passripple/settlement

**Kind:** module · **Level:** 4 (consumer)

## Responsibility

Append-only ledger per event, payout statements, payout records and organizer confirmation.

## Owns

The `settlement` database schema. No other module writes to it (rule R1).

## Depends on

- `@passripple/contracts`
- `@passripple/pricing`
- `@passripple/identity`
- `@passripple/events`
- `@passripple/orders`
- `@passripple/payments`

## Guarantees

- Invariant I9 (see [`docs/architecture.md`](../../docs/architecture.md#2-invariants))

## Does not

Move money. It calculates, records and reminds; a person makes the transfer.

## Public API

Everything other packages may use is exported from `src/index.ts`. Deep imports are not allowed.
