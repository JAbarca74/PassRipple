# @passripple/identity

**Kind:** module · **Level:** 1 (base domain)

## Responsibility

Accounts for staff, organizers, municipal inspectors and administrators; organizations; organizer verification, including the verified SINPE number used for payouts.

## Owns

The `identity` database schema. No other module writes to it (rule R1).

- `identity.organizations`: organizations, with `verified_at` set only by an administrator through `identity.set_organization_verified`. Publishing an event requires it.
- `identity.users`: accounts. No personal data yet.
- `identity.memberships`: which users act for which organization.
- `identity.users.email`: how a person signs in. The only personal data here; erasing an account clears it.
- `identity.sign_in_codes`: one-time codes sent by email, stored as a keyed HMAC, valid for at most 30 minutes, five per address in 15 minutes and five attempts each.
- `identity.user_sessions`: a person's sessions, by the SHA-256 of their token.

## Sign-in

| Function | Who | What |
|---|---|---|
| `identity.request_sign_in(email, code_hash, ttl)` | system | Records a code just sent. A sixth code in 15 minutes raises `PR429` |
| `identity.verify_sign_in(email, code_hash, token_hash, session_ttl)` | system | Opens a session for a matching code and returns the user, creating the account on first sign-in; returns NULL otherwise, so wrong attempts are counted |
| `identity.authenticate_session(token_hash)` | before the actor | The user behind a live session, or NULL |
| `identity.end_session(token_hash)` | anyone holding the token | Sign-out |

## Session actor

The API starts every transaction with `identity.set_actor(actor_id, actor_role, org_id)` instead of setting `app.*` itself. It rejects an unknown role, a disabled or unknown user, an administrator role for a user who is not one, and an organization the user is not an active member of. Buyers and the system role act with no account and no organization; only organizers act for an organization.

## Depends on

- `@passripple/contracts`

## Does not

Know what an event is. Buyers are not users: their contact lives on the order.

## Public API

Everything other packages may use is exported from `src/index.ts`. Deep imports are not allowed.
