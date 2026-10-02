# @passripple/contracts

**Kind:** core · **Level:** 0 (core)

## Responsibility

Shared vocabulary for the whole system: Zod schemas, TypeScript types, the domain event catalog, offline operation types and the QR binary format.

## Domain events

`src/domain-events.ts` holds the catalog of domain events (rule R3). Each is a plain object with a `type` discriminator, UUID strings for ids and ISO 8601 strings for times.

| Type | Emitted by | Meaning |
|---|---|---|
| `event.published` | `events` | An event went on sale |
| `event.updated` | `events` | An event's data changed |
| `event.cancelled` | `events` | An event was cancelled |
| `payment.succeeded` | `payments` | A bank notice became the payment of an order, and the order is paid |
| `ticket.issued` | `ticketing` | A ticket was issued |
| `ticket.bound` | `ticketing` | A ticket was bound to a device key, first or on recovery |
| `ticket.transferred` | `ticketing` | A ticket was transferred to another person's device |
| `ticket.voided` | `ticketing` | A ticket was voided |

## Credential QR format

`src/credential-format.ts` encodes and decodes the device-bound credential shown as a QR code: the server's certificate (62 signed bytes and the server's signature) followed by a 30-second time window and the device's signature, 194 bytes in all, as Base45 text (`src/base45.ts`, RFC 9285). Decoding accepts only canonical bytes and rejects unknown versions, wrong lengths, trailing bytes and reserved flag bits. It checks the format only: verifying the signatures is the job of `@passripple/crypto`.

## Gate manifest

`src/gate-manifest.ts` describes the package a gate device downloads before an event: the event and its window, the server keys it trusts, the ticket types, and for each ticket its type, entry mode, status, whether it was redeemed, its device key, key version and fallback code. It holds no secret (invariant I7). It travels as JSON with bytes in base64url (`src/base64url.ts`, canonical), whole the first time (`GateManifest`) and as deltas after that (`GateManifestDelta`), with a cursor and the server clock. `decodeGateManifest`, `decodeGateManifestDelta` and `decodeServerKeys` validate untrusted JSON.

## Gate operations

`src/gate-operations.ts` holds the operations a gate device records offline (`redemption`, `staff_scan`, `incident`) and the batch format of `POST /v1/gate/batches`: the API checks only the envelope, so a malformed operation is rejected on its own by the database instead of failing the batch.

## API wire format

`src/staff-api.ts` holds the Zod schemas of sign-in, staff codes and gate device enrollment, shared by the API, which validates untrusted input with them, and the gate app. The database checks everything again.

## Depends on

- `zod`, pinned. Schemas are declarations: no I/O.

## Does not

Contain behavior. It is vocabulary, not logic.

## Public API

Everything other packages may use is exported from `src/index.ts`. Deep imports are not allowed.
