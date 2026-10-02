# @passripple/identity

**Kind:** module · **Level:** 1 (base domain)

## Responsibility

Accounts for staff, organizers, municipal inspectors and administrators; organizations; organizer verification, including the verified SINPE number used for payouts.

## Owns

The `identity` database schema. No other module writes to it (rule R1).

- `identity.organizations`: organizations, with `verified_at` set only by an administrator through `identity.set_organization_verified`. Publishing an event requires it.
- `identity.users`: accounts. No personal data yet.
- `identity.memberships`: which users act for which organization.

## Session actor

The API starts every transaction with `identity.set_actor(actor_id, actor_role, org_id)` instead of setting `app.*` itself. It rejects an unknown role, a disabled or unknown user, an administrator role for a user who is not one, and an organization the user is not an active member of. Buyers and the system role act with no account and no organization; only organizers act for an organization.

## Depends on

- `@passripple/contracts`

## Does not

Know what an event is. Buyers are not users: their contact lives on the order.

## Public API

Everything other packages may use is exported from `src/index.ts`. Deep imports are not allowed.
