import { ed25519 } from "@noble/curves/ed25519.js";
import { utf8ToBytes } from "@noble/hashes/utils.js";

// Domain-separation tags, prepended to every signed or hashed message and never sent. A
// signature or hash made for one purpose can never be valid for another (ADR 0014).
export const CERTIFICATE_TAG = utf8ToBytes("PassRipple/cert/v1");
export const PRESENTATION_TAG = utf8ToBytes("PassRipple/present/v1");
export const EVENT_REF_TAG = utf8ToBytes("PassRipple/event/v1");

/**
 * Whether two byte arrays are equal, in time that depends only on their lengths. None of
 * the values compared in this package is secret, but there is no reason to leak more.
 */
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] as number) ^ (b[i] as number);
  return diff === 0;
}

/**
 * Strict Ed25519 verification (RFC 8032, not ZIP-215): canonical encodings only, S below
 * the group order, and small-order public keys rejected. A signature can therefore not be
 * altered into another valid one.
 */
export function verifyStrict(
  signature: Uint8Array,
  message: Uint8Array,
  publicKey: Uint8Array,
): boolean {
  try {
    return ed25519.verify(signature, message, publicKey, { zip215: false });
  } catch {
    return false;
  }
}

/**
 * Whether a public key may be bound to a ticket: a canonical encoding of a curve point
 * outside the small-order subgroup. A small-order key would let anyone sign for it.
 */
export function isAcceptableHolderKey(publicKey: Uint8Array): boolean {
  try {
    return !ed25519.Point.fromBytes(publicKey, false).isSmallOrder();
  } catch {
    return false;
  }
}
