# @passwave/orders

**Kind:** module · **Level:** 3 (transactional)

## Responsibility

Orders without buyer accounts: contact, wallet access token, payment code, exact amount and frozen fees.

## Owns

The `orders` database schema. No other module writes to it (rule R1).

## Depends on

- `@passwave/contracts`
- `@passwave/pricing`
- `@passwave/events`
- `@passwave/catalog`
- `@passwave/inventory`

## Guarantees

- Invariant I5 (see [`docs/architecture.md`](../../docs/architecture.md#2-invariants))

## Does not

Talk to banks or payment providers.

## Public API

Everything other packages may use is exported from `src/index.ts`. Deep imports are not allowed.
