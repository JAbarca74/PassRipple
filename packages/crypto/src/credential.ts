// The device-bound credential: the server's certificate plus the device's signature of
// the current 30-second window (6.2), and how a gate device verifies it offline (6.3).

import { concatBytes } from "@noble/hashes/utils.js";
import {
  CERTIFICATE_BODY_LENGTH,
  type Certificate,
  type CertificateFields,
  type DecodeError,
  decodeBase45,
  decodeQrPayload,
  encodeCertificateBody,
  encodeQr,
  encodeTimeWindow,
  MAX_TIME_WINDOW,
  SIGNATURE_LENGTH,
} from "@passripple/contracts";
import { bytesEqual, isAcceptableHolderKey, PRESENTATION_TAG, verifyStrict } from "./bytes.ts";
import { certificateMessage, eventRef } from "./certificate.ts";
import type { ServerKeyRing, Signer } from "./signer.ts";

export const WINDOW_MS = 30_000;
/** How many windows a credential may be ahead or behind the gate device's clock. */
export const WINDOW_TOLERANCE = 2;

/** The 30-second window a time falls in. */
export function timeWindow(ms: number): number {
  if (!Number.isFinite(ms) || ms < 0) throw new RangeError(`not a time: ${ms}`);
  const window = Math.floor(ms / WINDOW_MS);
  if (window > MAX_TIME_WINDOW) throw new RangeError(`time beyond the last window: ${ms}`);
  return window;
}

/**
 * The message the device signs: a domain tag, the 62-byte certificate body and the
 * window. Signing the whole body, not only the ticket id, ties the signature to one
 * certificate, so it can never be paired with another certificate of the same ticket.
 */
function presentationMessage(body: Uint8Array, window: Uint8Array): Uint8Array {
  return concatBytes(PRESENTATION_TAG, body, window);
}

/**
 * The QR text the wallet shows now: the certificate and the device's signature of the
 * current window. Throws if the device does not hold the certificate's key (for example,
 * the certificate predates a transfer) or if its signature does not verify.
 */
export async function presentCredential(
  certificate: Certificate,
  holder: Signer,
  nowMs: number,
): Promise<string> {
  if (!bytesEqual(holder.publicKey, certificate.fields.holderPubkey)) {
    throw new Error("this device does not hold the certificate's key");
  }
  const window = timeWindow(nowMs);
  const message = presentationMessage(
    encodeCertificateBody(certificate.fields),
    encodeTimeWindow(window),
  );
  const holderSig = await holder.sign(message);
  if (
    holderSig.length !== SIGNATURE_LENGTH ||
    !verifyStrict(holderSig, message, holder.publicKey)
  ) {
    throw new Error("the device produced a signature that does not verify");
  }
  return encodeQr({ certificate, timeWindow: window, holderSig });
}

/** What a gate device is checking against. */
export interface VerificationContext {
  /** The server's public keys this device trusts. */
  readonly serverKeys: ServerKeyRing;
  /** Lowercase UUID of the event this device admits to. */
  readonly eventId: string;
}

/** A credential that passed steps 1 to 3 of 6.3. */
export interface VerifiedCredential extends CertificateFields {
  readonly timeWindow: number;
}

export type RejectionReason =
  | "unknown_server_key"
  | "bad_server_signature"
  | "weak_holder_key"
  | "bad_holder_signature"
  | "stale_window"
  | "future_window"
  | "wrong_event";

export type Verdict =
  | {
      readonly ok: true;
      readonly credential: VerifiedCredential;
      /** The credential's window minus the device's, from -2 to 2. */
      readonly windowOffset: number;
    }
  | { readonly ok: false; readonly reason: "malformed"; readonly detail: DecodeError }
  | { readonly ok: false; readonly reason: RejectionReason };

/**
 * Verifies a credential offline, with public keys only (steps 1 to 3 of 6.3). It does not
 * check the manifest (step 4): whether the ticket was redeemed or voided, or whether a
 * newer key version exists, is the gate device's next question.
 *
 * Checks run in this order, so the reason is exact and nothing unauthenticated ever earns
 * a reason about time or event: format, server key, server signature, device key, device
 * signature, window (±2 around `nowMs`, the device's corrected clock) and event.
 */
export function verifyCredential(qr: string, context: VerificationContext, nowMs: number): Verdict {
  const bytes = decodeBase45(qr);
  if (bytes === null) return { ok: false, reason: "malformed", detail: "invalid_base45" };
  const decoded = decodeQrPayload(bytes);
  if (!decoded.ok) return { ok: false, reason: "malformed", detail: decoded.error };
  const { certificate, timeWindow: window, holderSig } = decoded.value;
  const { fields } = certificate;

  // Signatures cover the bytes as received. Decoding is canonical, so they are also
  // exactly the bytes of the decoded fields.
  const body = bytes.subarray(0, CERTIFICATE_BODY_LENGTH);

  const serverKey = context.serverKeys.get(fields.serverKeyId);
  if (serverKey === undefined) return { ok: false, reason: "unknown_server_key" };
  if (!verifyStrict(certificate.serverSig, certificateMessage(body), serverKey)) {
    return { ok: false, reason: "bad_server_signature" };
  }

  if (!isAcceptableHolderKey(fields.holderPubkey)) return { ok: false, reason: "weak_holder_key" };
  const message = presentationMessage(body, bytes.subarray(126, 130));
  if (!verifyStrict(holderSig, message, fields.holderPubkey)) {
    return { ok: false, reason: "bad_holder_signature" };
  }

  const windowOffset = window - timeWindow(nowMs);
  if (windowOffset < -WINDOW_TOLERANCE) return { ok: false, reason: "stale_window" };
  if (windowOffset > WINDOW_TOLERANCE) return { ok: false, reason: "future_window" };

  if (!bytesEqual(fields.eventRef, eventRef(context.eventId))) {
    return { ok: false, reason: "wrong_event" };
  }

  return { ok: true, credential: { ...fields, timeWindow: window }, windowOffset };
}
