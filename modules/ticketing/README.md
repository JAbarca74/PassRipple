# @passripple/ticketing

**Kind:** module · **Level:** 2 (composite domain)

## Responsibility

Ticket lifecycle: issue, bind to the buyer's device key, assign an attendee, transfer, void.

## Owns

The `ticketing` database schema. No other module writes to it (rule R1).

- `ticketing.tickets`: one row per ticket, whatever its origin (`sale`, `courtesy`, `door_sale`). Its entry mode is copied from its type when it is issued, and the type must belong to its event. Only the status and binding change (`unsold` → `issued` or `void`; `issued` → `bound` or `void`; `bound` → `bound` or `void`), and no ticket is deleted.

There is no `redeemed` status: `redemption` records whether a ticket was used (invariant I1). Device binding arrives with the credentials (Phase 1), and named attendees, whose documents must be encrypted at rest, in Phase 7.

| Function | Who | What |
|---|---|---|
| `ticketing.issue(event, ticket_type, order, origin, code_human)` | system | Issues one ticket |
| `ticketing.void(ticket)` | organizer, admin | Voids a ticket, online only |

## Emits

`ticket.issued` and `ticket.voided` (see `@passripple/contracts`).

## Depends on

- `@passripple/contracts`
- `@passripple/crypto`
- `@passripple/events`
- `@passripple/catalog`

## Emits

- `ticket.issued`
- `ticket.bound`
- `ticket.transferred`
- `ticket.voided`

## Does not

Validate tickets at the gate, charge money, or send notifications.

## Public API

Everything other packages may use is exported from `src/index.ts`. Deep imports are not allowed.
