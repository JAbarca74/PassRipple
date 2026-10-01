# @passwave/crypto

**Kind:** core · **Level:** 0 (core)

## Responsibility

Server certificates, device-bound credential presentation and verification, and human-readable ticket codes with a check digit.

## Depends on

- `@passwave/contracts`

## Guarantees

- Invariant I7 (see [`docs/architecture.md`](../../docs/architecture.md#2-invariants))

## Does not

Touch the database, read the clock or the environment, or store keys. Time and keys are parameters.

## Public API

Everything other packages may use is exported from `src/index.ts`. Deep imports are not allowed.
