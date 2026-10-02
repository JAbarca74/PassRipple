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

Signatures are verified strictly (RFC 8032, not ZIP-215), and keys of small order are never accepted. Every signed or hashed message starts with a domain tag.

## Public API

Everything other packages may use is exported from `src/index.ts`. Deep imports are not allowed.

| Export | What it does |
|---|---|
| `signCertificate(input, serverSigner)` | Signs a certificate binding a ticket to a device key. Refuses unacceptable keys, and checks the signature with the signer's own public key |
| `verifyCertificate(certificate, serverKeys)` | Whether a key in the ring signed a certificate |
| `eventRef(eventId)` | The 8-byte event reference a credential carries (ADR 0013) |
