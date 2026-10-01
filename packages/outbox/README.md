# @passwave/outbox

**Kind:** core · **Level:** 0 (core)

## Responsibility

Durable on-device queue: enqueue operations and drain them in batches through an injected `Transport`.

## Depends on

- `@passwave/contracts`

## Guarantees

- Invariant I6 (see [`docs/architecture.md`](../../docs/architecture.md#2-invariants))

## Does not

Know what a redemption, a sale or a courtesy is. Payloads are opaque.

## Public API

Everything other packages may use is exported from `src/index.ts`. Deep imports are not allowed.
