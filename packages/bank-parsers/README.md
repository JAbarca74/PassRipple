# @passwave/bank-parsers

**Kind:** core · **Level:** 0 (core)

## Responsibility

Deterministic parsers that turn a bank payment notice (email or SMS) into a typed record. One parser per bank template.

## Depends on

- `@passwave/contracts`

## Does not

Decide that a payment is valid, call any AI model, or interpret the payer's description beyond matching order codes.

## Public API

Everything other packages may use is exported from `src/index.ts`. Deep imports are not allowed.
