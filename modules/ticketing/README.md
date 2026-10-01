# @passripple/ticketing

**Kind:** module · **Level:** 2 (composite domain)

## Responsibility

Ticket lifecycle: issue, bind to the buyer's device key, assign an attendee, transfer, void.

## Owns

The `ticketing` database schema. No other module writes to it (rule R1).

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
