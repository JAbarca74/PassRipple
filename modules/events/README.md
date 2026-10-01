# @passwave/events

**Kind:** module · **Level:** 1 (base domain)

## Responsibility

The event itself: venue, canton, dates, age rating, permitted capacity, permit, and the publishing gate.

## Owns

The `events` database schema. No other module writes to it (rule R1).

## Depends on

- `@passwave/contracts`
- `@passwave/identity`
- `@passwave/jurisdictions`

## Does not

Know about prices or sales.

## Public API

Everything other packages may use is exported from `src/index.ts`. Deep imports are not allowed.
