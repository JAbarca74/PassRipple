# @passripple/inventory

**Kind:** module · **Level:** 2 (composite domain)

## Responsibility

Availability, time-limited holds, the capacity counter, and exclusive ticket blocks for door-sale devices.

## Owns

The `inventory` database schema. No other module writes to it (rule R1).

- `inventory.event_capacity`: one row per published event with its own copy of the permitted capacity and the `committed` counter (ADR 0004). `CHECK (committed <= permitted_capacity)` is the second safety net of invariant I2.
- `inventory.holds`: capacity committed for a checkout, until it is released, expires or becomes issued tickets.
- `inventory.capacity_incidents`: append-only record of a permitted capacity lowered below what was already committed.

The API never writes these tables. It calls:

| Function | Who | What |
|---|---|---|
| `inventory.hold(event, ticket_type, quantity, ttl)` | buyer, system | One conditional `UPDATE` of the event's counter; returns the hold, or NULL when there is no capacity or the event is not on sale. Holds last 30 minutes by default |
| `inventory.release_hold(hold)` | buyer, system | Gives the capacity back; a second call changes nothing |
| `inventory.expire_holds(now)` | system | Ends every expired hold and gives its capacity back |
| `inventory.apply_event_published(event)` | system | Creates the counter from `event.published` (ADR 0010) |
| `inventory.apply_event_updated(event)` | system | Copies the permitted capacity again; below the committed count, the copy is kept and an incident is recorded |

`inventory.convert_hold(hold)` is for `orders`, when an order is paid: the hold ends and keeps its capacity as issued tickets. Contention is always one event's row.

## Handles

`event.published` and `event.updated`, through the functions above.

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
