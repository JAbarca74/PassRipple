# @passripple/redemption

**Kind:** module · **Level:** 3 (transactional)

## Responsibility

Ticket redemption, applying offline batches from gate devices, and duplicate detection.

## Owns

The `redemption` database schema. No other module writes to it (rule R1).

## Depends on

- `@passripple/contracts`
- `@passripple/crypto`
- `@passripple/ticketing`
- `@passripple/staff`

## Guarantees

- Invariant I1 (see [`docs/architecture.md`](../../docs/architecture.md#2-invariants))
- Invariant I6 (see [`docs/architecture.md`](../../docs/architecture.md#2-invariants))

## Does not

Verify signatures (that is `crypto`) or queue operations (that is `outbox`).

## Public API

Everything other packages may use is exported from `src/index.ts`. Deep imports are not allowed.
