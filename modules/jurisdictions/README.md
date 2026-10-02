# @passripple/jurisdictions

**Kind:** module · **Level:** 1 (base domain)

## Responsibility

Tax and oversight rules for each canton, stored as data (rule R6).

## Owns

The `jurisdictions` database schema. No other module writes to it (rule R1).

- `jurisdictions.jurisdictions`: one row per canton, keyed by `canton_code`, with its tax rate, deductible complimentary limits per ticket category, settlement rule, advance guarantee, whether it accepts digital tickets (`yes`, `no`, `unknown`) and its report format. Rates are basis points from 0 to 10000.

Canton rules are public reference data: every role allowed to read the table sees every row. Only an API request acting as `admin` inserts or updates a canton, the canton code never changes, and no canton is deleted. Adding a canton is an `INSERT`, never a deployment.

The repository holds no real canton rules: they are loaded as data in each environment.

## Depends on

- `@passripple/contracts`

## Does not

Calculate anything. The `tax` package does the math.

## Public API

Everything other packages may use is exported from `src/index.ts`. Deep imports are not allowed.
