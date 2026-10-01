# @passripple/contracts

**Kind:** core · **Level:** 0 (core)

## Responsibility

Shared vocabulary for the whole system: Zod schemas, TypeScript types, the domain event catalog, offline operation types and the QR binary format.

## Depends on

Nothing.

## Does not

Contain behavior. It is vocabulary, not logic.

## Public API

Everything other packages may use is exported from `src/index.ts`. Deep imports are not allowed.
