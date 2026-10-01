# @passwave/catalog

**Kind:** module · **Level:** 1 (base domain)

## Responsibility

Ticket types, prices and zones.

## Owns

The `catalog` database schema. No other module writes to it (rule R1).

## Depends on

- `@passwave/contracts`
- `@passwave/events`

## Does not

Track availability. That is `inventory`.

## Public API

Everything other packages may use is exported from `src/index.ts`. Deep imports are not allowed.
