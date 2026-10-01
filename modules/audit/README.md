# @passripple/audit

**Kind:** module · **Level:** 4 (consumer)

## Responsibility

Append-only, hash-chained audit log.

## Owns

The `audit` database schema. No other module writes to it (rule R1).

## Depends on

- `@passripple/contracts`

## Does not

Store personal data, so that erasing a user never breaks the chain.

## Public API

Everything other packages may use is exported from `src/index.ts`. Deep imports are not allowed.
