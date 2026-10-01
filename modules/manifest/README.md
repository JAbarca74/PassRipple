# @passwave/manifest

**Kind:** module · **Level:** 3 (transactional)

## Responsibility

Builds the secret-free package each gate device downloads before an event.

## Owns

The `manifest` database schema. No other module writes to it (rule R1).

## Depends on

- `@passwave/contracts`
- `@passwave/crypto`
- `@passwave/ticketing`
- `@passwave/inventory`
- `@passwave/courtesy`
- `@passwave/staff`

## Guarantees

- Invariant I7 (see [`docs/architecture.md`](../../docs/architecture.md#2-invariants))

## Does not

Sync data back from devices. That is `redemption`.

## Public API

Everything other packages may use is exported from `src/index.ts`. Deep imports are not allowed.
