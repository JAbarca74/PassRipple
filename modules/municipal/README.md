# @passripple/municipal

**Kind:** module · **Level:** 4 (consumer)

## Responsibility

Municipal oversight portal, inspector mode, emission authorization and the post-event declaration.

## Owns

The `municipal` database schema. No other module writes to it (rule R1).

## Depends on

- `@passripple/contracts`
- `@passripple/tax`
- `@passripple/jurisdictions`
- `@passripple/events`

## Does not

Modify domain data.

## Public API

Everything other packages may use is exported from `src/index.ts`. Deep imports are not allowed.
