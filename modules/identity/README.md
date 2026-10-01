# @passwave/identity

**Kind:** module · **Level:** 1 (base domain)

## Responsibility

Accounts for staff, organizers, municipal inspectors and administrators; organizations; organizer verification, including the verified SINPE number used for payouts.

## Owns

The `identity` database schema. No other module writes to it (rule R1).

## Depends on

- `@passwave/contracts`

## Does not

Know what an event is. Buyers are not users: their contact lives on the order.

## Public API

Everything other packages may use is exported from `src/index.ts`. Deep imports are not allowed.
