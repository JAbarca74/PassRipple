# @passwave/jurisdictions

**Kind:** module · **Level:** 1 (base domain)

## Responsibility

Tax and oversight rules for each canton, stored as data (rule R6).

## Owns

The `jurisdictions` database schema. No other module writes to it (rule R1).

## Depends on

- `@passwave/contracts`

## Does not

Calculate anything. The `tax` package does the math.

## Public API

Everything other packages may use is exported from `src/index.ts`. Deep imports are not allowed.
