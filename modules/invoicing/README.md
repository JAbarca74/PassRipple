# @passripple/invoicing

**Kind:** module · **Level:** 4 (consumer)

## Responsibility

Reserved for electronic invoicing. It will consume `payment.succeeded`, so adding it changes no other module.

## Owns

The `invoicing` database schema. No other module writes to it (rule R1).

## Depends on

- `@passripple/contracts`

## Does not

Exist yet beyond its boundary.

## Public API

Everything other packages may use is exported from `src/index.ts`. Deep imports are not allowed.
