# @passwave/seo

**Kind:** module · **Level:** 4 (consumer)

## Responsibility

Pre-rendered public event pages, metadata, structured data and the sitemap.

## Owns

The `seo` database schema. No other module writes to it (rule R1).

## Depends on

- `@passwave/contracts`
- `@passwave/events`
- `@passwave/catalog`

## Does not

Touch the checkout.

## Public API

Everything other packages may use is exported from `src/index.ts`. Deep imports are not allowed.
