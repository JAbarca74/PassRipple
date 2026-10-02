# @passripple/staff

**Kind:** module · **Level:** 2 (composite domain)

## Responsibility

Staff codes, device enrollment, roles, zones, time windows and revocation.

## Owns

The `staff` database schema. No other module writes to it (rule R1).

## Depends on

- `@passripple/contracts`
- `@passripple/identity`
- `@passripple/events`

## Does not

Validate tickets. It only says who may do it.

## Public API

Everything other packages may use is exported from `src/index.ts`. Deep imports are not allowed.
