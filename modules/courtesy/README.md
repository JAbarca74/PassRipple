# @passripple/courtesy

**Kind:** module · **Level:** 2 (composite domain)

## Responsibility

Complimentary ticket quotas and authorizations, including quotas reserved per device for offline use.

## Owns

The `courtesy` database schema. No other module writes to it (rule R1).

## Depends on

- `@passripple/contracts`
- `@passripple/events`
- `@passripple/ticketing`

## Guarantees

- Invariant I3 (see [`docs/architecture.md`](../../docs/architecture.md#2-invariants))

## Does not

Issue tickets itself. It asks `ticketing`, so a complimentary ticket is a normal ticket.

## Public API

Everything other packages may use is exported from `src/index.ts`. Deep imports are not allowed.
