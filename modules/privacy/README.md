# @passripple/privacy

**Kind:** module · **Level:** 1 (base domain)

## Responsibility

Consents, legal document versions, and data erasure and export requests.

## Owns

The `privacy` database schema. No other module writes to it (rule R1).

## Depends on

- `@passripple/contracts`
- `@passripple/identity`

## Emits

- `user.erasure_requested`
- `user.export_requested`

## Does not

Delete other modules' data. Each module erases its own data in response to the event.

## Public API

Everything other packages may use is exported from `src/index.ts`. Deep imports are not allowed.
