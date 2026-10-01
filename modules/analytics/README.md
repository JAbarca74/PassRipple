# @passwave/analytics

**Kind:** module · **Level:** 4 (consumer)

## Responsibility

Server-side conversions to analytics platforms, sent only with recorded consent.

## Owns

The `analytics` database schema. No other module writes to it (rule R1).

## Depends on

- `@passwave/contracts`
- `@passwave/privacy`

## Guarantees

- Invariant I8 (see [`docs/architecture.md`](../../docs/architecture.md#2-invariants))

## Does not

Run any script where buyer keys or personal data live.

## Public API

Everything other packages may use is exported from `src/index.ts`. Deep imports are not allowed.
