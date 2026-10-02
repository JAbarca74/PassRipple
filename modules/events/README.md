# @passripple/events

**Kind:** module · **Level:** 1 (base domain)

## Responsibility

The event itself: venue, canton, dates, age rating, permitted capacity, permit, and the publishing gate.

## Owns

The `events` database schema. No other module writes to it (rule R1).

- `events.events`: one row per event. `permitted_capacity` is the permit's figure; the counter that enforces I2 is in `inventory` (ADR 0004).

Organizers create and edit their organization's events while they are a draft, pending authorization or on sale. The status changes only through functions:

| Function | Who | Change |
|---|---|---|
| `events.publish(id)` | organizer | `draft` or `pending_auth` → `on_sale`, only if the organization is verified and the permit number is recorded |
| `events.close(id)` | organizer, admin, system | `on_sale` → `closed` |
| `events.cancel(id)` | organizer, admin | anything not closed → `cancelled` |

## Emits

`event.published`, `event.updated` and `event.cancelled` (see `@passripple/contracts`), after the transaction that changed the event commits.

## Depends on

- `@passripple/contracts`
- `@passripple/identity`
- `@passripple/jurisdictions`

## Does not

Know about prices or sales.

## Public API

Everything other packages may use is exported from `src/index.ts`. Deep imports are not allowed.
