# @passwave/door-sales

**Kind:** module · **Level:** 3 (transactional)

## Responsibility

Door sales from a device's exclusive block: tickets issued already redeemed and recorded for settlement.

## Owns

The `door_sales` database schema. No other module writes to it (rule R1).

## Depends on

- `@passwave/contracts`
- `@passwave/inventory`
- `@passwave/ticketing`
- `@passwave/staff`

## Does not

Process payments. The organizer collects door sales directly.

## Public API

Everything other packages may use is exported from `src/index.ts`. Deep imports are not allowed.
