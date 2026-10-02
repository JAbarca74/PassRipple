# @passripple/courtesy

**Kind:** module · **Level:** 2 (composite domain)

## Responsibility

Complimentary ticket quotas and authorizations, including quotas reserved per device for offline use.

## Owns

The `courtesy` database schema. No other module writes to it (rule R1).

- `courtesy.event_quotas`: one row per event with its declared complimentary quota and how many were granted. `CHECK (granted <= declared_quota)` is the second safety net of invariant I3.
- `courtesy.grants`: append-only record of each grant and who made it.

The API never writes these tables. An organizer of the event's organization calls, while the event can still change:

| Function | What |
|---|---|
| `courtesy.declare_quota(event, quota)` | Declares or changes the quota; a quota below what was already granted is refused |
| `courtesy.grant_tickets(event, quantity)` | One conditional `UPDATE` of the event's quota; returns the grant, or NULL when there is no room left |

Issuing the tickets through `ticketing`, counting them against the event's capacity (I2) and reserving part of the quota for offline devices arrive in Phase 7.

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
