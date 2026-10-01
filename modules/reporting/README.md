# @passripple/reporting

**Kind:** module · **Level:** 4 (consumer)

## Responsibility

Aggregated counters for dashboards and gate device sync status. Read-only.

## Owns

The `reporting` database schema. No other module writes to it (rule R1).

## Depends on

- `@passripple/contracts`

## Does not

Write domain data.

## Public API

Everything other packages may use is exported from `src/index.ts`. Deep imports are not allowed.
