# @passripple/inventory

**Kind:** module · **Level:** 2 (composite domain)

## Responsibility

Availability, time-limited holds, the capacity counter, and exclusive ticket blocks for door-sale devices.

## Owns

The `inventory` database schema. No other module writes to it (rule R1).

## Depends on

- `@passripple/contracts`
- `@passripple/events`
- `@passripple/catalog`

## Guarantees

- Invariant I2 (see [`docs/architecture.md`](../../docs/architecture.md#2-invariants))

## Does not

Know about money or buyers.

## Public API

Everything other packages may use is exported from `src/index.ts`. Deep imports are not allowed.
