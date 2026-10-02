// How keys reach this package (ADR 0014). crypto never holds a private key: whoever owns
// one wraps it in a Signer. The buyer's wallet wraps a non-extractable WebCrypto key, the
// issuing Worker wraps the server key from its secrets, and tests wrap a fixed seed.
// Every signer must produce pure Ed25519 signatures (RFC 8032), as WebCrypto and
// @noble/curves both do.

/** Signs messages with one Ed25519 key it keeps to itself. */
export interface Signer {
  /** The 32-byte Ed25519 public key of the key it signs with. */
  readonly publicKey: Uint8Array;
  /** The 64-byte Ed25519 signature of a message. */
  sign(message: Uint8Array): Promise<Uint8Array>;
}

/** A signer holding one of the server's keys, which the key ring knows by its id. */
export interface ServerSigner extends Signer {
  /** 0 to 255, written into every certificate it signs. */
  readonly keyId: number;
}

/**
 * The server's public keys a device trusts, by id. It holds only valid keys: retiring a
 * key means removing it, and every certificate it signed stops verifying.
 */
export type ServerKeyRing = ReadonlyMap<number, Uint8Array>;
