# @passwave/notifications

**Kind:** module · **Level:** 4 (consumer)

## Responsibility

Push notifications and email, in reaction to domain events.

## Owns

The `notifications` database schema. No other module writes to it (rule R1).

## Depends on

- `@passwave/contracts`

## Does not

Decide on its own when to notify.

## Public API

Everything other packages may use is exported from `src/index.ts`. Deep imports are not allowed.
