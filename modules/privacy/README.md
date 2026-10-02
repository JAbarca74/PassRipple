# @passripple/privacy

**Kind:** module · **Level:** 1 (base domain)

## Responsibility

Consents, legal document versions, and data erasure and export requests.

## Owns

The `privacy` database schema. No other module writes to it (rule R1).

- `privacy.legal_documents`: published versions of the terms, privacy policy and cookie policy, with the SHA-256 of each text. Public and append-only: a new text is a new version.
- `privacy.consents`: every acceptance or refusal, with its purpose, the document version and where it was given. Append-only: changing a choice adds a new consent. The subject is a user's id or an anonymous identifier, never contact data.

| Function | Who | What |
|---|---|---|
| `privacy.record_consent(subject, purpose, granted, document_version, source)` | any actor | A person with an account records only their own consent; buyers use an anonymous identifier |
| `privacy.publish_document(kind, version, content_sha256)` | admin | Publishes a new document version |

People with an account see their own consents; administrators see all. Erasure and export requests arrive in a later phase.

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
