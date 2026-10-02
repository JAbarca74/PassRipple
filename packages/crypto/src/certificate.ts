// The server's certificate: "this ticket belongs to the device holding this key" (6.2).

import { sha256 } from "@noble/hashes/sha2.js";
import { concatBytes } from "@noble/hashes/utils.js";
import {
  type AgeRating,
  type Certificate,
  type CertificateFields,
  type EntryMode,
  EVENT_REF_LENGTH,
  encodeCertificateBody,
  SIGNATURE_LENGTH,
  uuidToBytes,
} from "@passripple/contracts";
import { CERTIFICATE_TAG, EVENT_REF_TAG, isAcceptableHolderKey, verifyStrict } from "./bytes.ts";
import type { ServerKeyRing, ServerSigner } from "./signer.ts";

/** What the issuing Worker knows about a bound ticket. */
export interface CertificateInput {
  /** Lowercase UUID. */
  readonly ticketId: string;
  /** Lowercase UUID of the ticket's event. */
  readonly eventId: string;
  /** The ticket type's number within its event. */
  readonly typeRef: number;
  readonly entryMode: EntryMode;
  readonly ageRating: AgeRating;
  readonly named: boolean;
  /** Ed25519 public key of the buyer's device. */
  readonly holderPubkey: Uint8Array;
  /** The ticket's current key version, 1 or more. */
  readonly keyVersion: number;
}

/**
 * The 8-byte reference to an event carried by a credential: the first bytes of SHA-256
 * over a domain tag and the event id. Uniform whatever the UUID version (ADR 0013).
 */
export function eventRef(eventId: string): Uint8Array {
  return sha256(concatBytes(EVENT_REF_TAG, uuidToBytes(eventId))).slice(0, EVENT_REF_LENGTH);
}

/** The message the server signs: a domain tag and the 62-byte certificate body. */
export function certificateMessage(body: Uint8Array): Uint8Array {
  return concatBytes(CERTIFICATE_TAG, body);
}

/**
 * Signs a certificate binding a ticket to the buyer's device key. Throws if the key may
 * not be bound (not a valid point, or of small order), if a field is outside the format,
 * or if the signer returns a signature that does not verify with its own public key,
 * which catches a misconfigured key or key id before the certificate leaves the server.
 */
export async function signCertificate(
  input: CertificateInput,
  server: ServerSigner,
): Promise<Certificate> {
  if (!isAcceptableHolderKey(input.holderPubkey)) {
    throw new RangeError("holderPubkey: not an acceptable Ed25519 public key");
  }
  const fields: CertificateFields = {
    serverKeyId: server.keyId,
    ticketId: input.ticketId,
    eventRef: eventRef(input.eventId),
    typeRef: input.typeRef,
    entryMode: input.entryMode,
    ageRating: input.ageRating,
    named: input.named,
    holderPubkey: input.holderPubkey,
    keyVersion: input.keyVersion,
  };
  const message = certificateMessage(encodeCertificateBody(fields));
  const serverSig = await server.sign(message);
  if (
    serverSig.length !== SIGNATURE_LENGTH ||
    !verifyStrict(serverSig, message, server.publicKey)
  ) {
    throw new Error(`server key ${server.keyId} produced a signature that does not verify`);
  }
  return { fields, serverSig };
}

/**
 * Whether a certificate was signed by a key in the ring. The wallet uses it to check a
 * certificate it receives; gate devices verify whole credentials with verifyCredential.
 */
export function verifyCertificate(certificate: Certificate, serverKeys: ServerKeyRing): boolean {
  const serverKey = serverKeys.get(certificate.fields.serverKeyId);
  if (serverKey === undefined) return false;
  let body: Uint8Array;
  try {
    body = encodeCertificateBody(certificate.fields);
  } catch {
    return false;
  }
  return verifyStrict(certificate.serverSig, certificateMessage(body), serverKey);
}
