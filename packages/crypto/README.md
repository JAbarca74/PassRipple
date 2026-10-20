# @passripple/crypto

**Kind:** core · **Level:** 0 (core)

## Responsibility

Server certificates, device-bound credential presentation and verification, and human-readable ticket codes with a check digit.

## Depends on

- `@passripple/contracts`
- `@noble/curves` and `@noble/hashes`, pinned. No other cryptography library, and no primitive of our own.

## Guarantees

- Invariant I7 (see [`docs/architecture.md`](../../docs/architecture.md#2-invariants))

## Does not

Touch the database, read the clock or the environment, or store keys. Time and keys are parameters.

## Keys, time and randomness

This package never holds a private key, reads the clock or draws randomness (rule R4):

- **Keys** arrive as a `Signer`: a public key and an async `sign(message)`. The wallet wraps a non-extractable WebCrypto key, the issuing Worker wraps the server key from its secrets. Both produce pure Ed25519 signatures (RFC 8032), the same as `@noble/curves`.
- **The server's public keys** arrive as a `ServerKeyRing` (id → key). It holds only valid keys: retiring a key means removing it.
- **Time** arrives as milliseconds.
- **Randomness** arrives as bytes: `humanCode` takes the 6 bytes the caller drew with `crypto.getRandomValues`.

Signatures are verified strictly (RFC 8032, not ZIP-215), and keys of small order are never accepted. Every signed or hashed message starts with a domain tag.

## Public API

Everything other packages may use is exported from `src/index.ts`. Deep imports are not allowed.

| Export | What it does |
|---|---|
| `signCertificate(input, serverSigner)` | Signs a certificate binding a ticket to a device key. Refuses unacceptable keys, and checks the signature with the signer's own public key |
| `verifyCertificate(certificate, serverKeys)` | Whether a key in the ring signed a certificate |
| `eventRef(eventId)` | The 8-byte event reference a credential carries (ADR 0013) |
| `presentCredential(certificate, holderSigner, nowMs)` | The QR text the wallet shows: the certificate and the device's signature of the current 30-second window, over a domain tag, the certificate body and the window |
| `verifyCredential(qr, { serverKeys, eventId }, nowMs)` | Offline verification, steps 1 to 3 of the design's 6.3. Returns a `Verdict`: the credential, or the exact reason it was rejected |
| `timeWindow(ms)` | The 30-second window a time falls in |
| `humanCode(entropy)` | A new 10-character fallback code (Crockford Base32, Damm check character) from exactly 6 random bytes |
| `normalizeHumanCode(input)` | The canonical code as typed, or `null`: ignores hyphens and spaces, accepts lowercase, reads O as 0 and I or L as 1 |
| `validateHumanCode(input)` | Whether the input is a valid code |
| `formatHumanCode(code)` | The code as shown to people, `4K7NP-9XR2M` |
| `payCode(entropy)` | A new payment code (5 Crockford characters and the same Damm check) from exactly 4 random bytes (ADR 0033) |
| `normalizePayCode(word)`, `findPayCodes(description)` | The well-formed payment codes written in an untrusted payment description, at most ten |
| `isAcceptableHolderKey(key)` | Whether a device key may be bound: a valid Ed25519 point not of small order |

`verifyCredential` checks, in order: the format, the server key id, the server's signature, the device key, the device's signature, the window (±2 around the device's corrected clock) and the event. Nothing unauthenticated gets a reason about time or event. It does not look at the manifest: whether the ticket was redeemed or voided, or has a newer key version, is the gate device's next check.

Within the tolerance, the same QR verifies more than once: crypto proves who holds the ticket, and redemption makes sure it is used once (invariant I1).
