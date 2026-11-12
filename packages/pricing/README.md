# @passripple/pricing

**Kind:** core · **Level:** 0 (core)

## Responsibility

Fee calculation and price breakdowns from a fee schedule received as a parameter.

`serviceCharge(price, schedule)` gives the charge and its tax per ticket, in whole colones (halves up); `feeRule(schedule)` is what an order line records; `checkFeeSchedule` validates a schedule. The schedule (rate, fixed amount, tax rate, and whether the tax is `included` or `added`) comes from the caller's configuration (ADR 0033).

## Depends on

- `@passripple/contracts`

## Does not

Load fee schedules. The caller passes them in.

## Public API

Everything other packages may use is exported from `src/index.ts`. Deep imports are not allowed.
