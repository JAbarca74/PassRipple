// Binary format of the device-bound credential shown as a QR code (ADR 0013).
//
//   offset  field          bytes
//        0  version            1   always CREDENTIAL_FORMAT_VERSION
//        1  server_key_id      1   which server key signed the certificate
//        2  ticket_id         16   UUID
//       18  event_ref          8   derived from the event id by crypto
//       26  type_ref           2   the ticket type's number within its event
//       28  flags              1   bit 0 entry mode, bits 1-2 age rating, bit 3 named,
//                                  bits 4-7 reserved and always 0
//       29  holder_pubkey     32   Ed25519 public key of the buyer's device
//       61  key_version        1   1 to 255; it goes up on every rebinding
//       62  server_sig        64   the server's signature over bytes 0-61
//      126  time_window        4   30-second window the device signed
//      130  holder_sig        64   the device's signature over bytes 0-61 and the window
//      194
//
// Integers are big-endian. The length is fixed, and decoding accepts only the one
// canonical encoding of each value, so decoding and re-encoding gives back the same bytes.
// Decoding checks the format only: whether the signatures hold is for crypto to say.

import { decodeBase45, encodeBase45 } from "./base45.ts";

export const CREDENTIAL_FORMAT_VERSION = 1;
/** Bytes 0-61: what the server signs. */
export const CERTIFICATE_BODY_LENGTH = 62;
/** The certificate body followed by the server's signature. */
export const CERTIFICATE_LENGTH = 126;
/** The certificate followed by the time window and the device's signature. */
export const QR_PAYLOAD_LENGTH = 194;

export const TICKET_ID_LENGTH = 16;
export const EVENT_REF_LENGTH = 8;
export const PUBLIC_KEY_LENGTH = 32;
export const SIGNATURE_LENGTH = 64;
export const MAX_SERVER_KEY_ID = 0xff;
export const MAX_TYPE_REF = 0xffff;
export const MIN_KEY_VERSION = 1;
export const MAX_KEY_VERSION = 0xff;
export const MAX_TIME_WINDOW = 0xffffffff;

export type EntryMode = "single_use" | "multi_scan";
export type AgeRating = "all" | "12plus" | "18plus";

/** What the server certifies: this ticket belongs to the device holding this key. */
export interface CertificateFields {
  readonly serverKeyId: number;
  /** Lowercase UUID. */
  readonly ticketId: string;
  readonly eventRef: Uint8Array;
  readonly typeRef: number;
  readonly entryMode: EntryMode;
  readonly ageRating: AgeRating;
  /** Whether the ticket is issued to a named attendee. */
  readonly named: boolean;
  readonly holderPubkey: Uint8Array;
  readonly keyVersion: number;
}

export interface Certificate {
  readonly fields: CertificateFields;
  readonly serverSig: Uint8Array;
}

/** What the QR code carries: the certificate and the device's signature of one window. */
export interface QrPayload {
  readonly certificate: Certificate;
  readonly timeWindow: number;
  readonly holderSig: Uint8Array;
}

export type DecodeError =
  | "invalid_base45"
  | "unknown_version"
  | "too_short"
  | "trailing_bytes"
  | "reserved_flags"
  | "invalid_age_rating"
  | "invalid_key_version";

export type DecodeResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: DecodeError };

const AGE_RATINGS: readonly AgeRating[] = ["all", "12plus", "18plus"];

const FLAG_MULTI_SCAN = 0b0001;
const FLAG_NAMED = 0b1000;
const AGE_SHIFT = 1;
const AGE_MASK = 0b0110;
const RESERVED_MASK = 0xf0;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// ── Encoding ─────────────────────────────────────────────────────────────────
// Encoding a value outside the format is a programming error, so it throws.

/** The bytes the server signs. */
export function encodeCertificateBody(fields: CertificateFields): Uint8Array {
  const bytes = new Uint8Array(CERTIFICATE_BODY_LENGTH);
  const view = new DataView(bytes.buffer);
  bytes[0] = CREDENTIAL_FORMAT_VERSION;
  bytes[1] = checkInteger("serverKeyId", fields.serverKeyId, 0, MAX_SERVER_KEY_ID);
  bytes.set(uuidToBytes(fields.ticketId), 2);
  bytes.set(checkLength("eventRef", fields.eventRef, EVENT_REF_LENGTH), 18);
  view.setUint16(26, checkInteger("typeRef", fields.typeRef, 0, MAX_TYPE_REF));
  bytes[28] = encodeFlags(fields);
  bytes.set(checkLength("holderPubkey", fields.holderPubkey, PUBLIC_KEY_LENGTH), 29);
  bytes[61] = checkInteger("keyVersion", fields.keyVersion, MIN_KEY_VERSION, MAX_KEY_VERSION);
  return bytes;
}

export function encodeCertificate(certificate: Certificate): Uint8Array {
  const bytes = new Uint8Array(CERTIFICATE_LENGTH);
  bytes.set(encodeCertificateBody(certificate.fields), 0);
  bytes.set(checkLength("serverSig", certificate.serverSig, SIGNATURE_LENGTH), 62);
  return bytes;
}

/** The 4 big-endian bytes of a time window. */
export function encodeTimeWindow(timeWindow: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(
    0,
    checkInteger("timeWindow", timeWindow, 0, MAX_TIME_WINDOW),
  );
  return bytes;
}

export function encodeQrPayload(payload: QrPayload): Uint8Array {
  const bytes = new Uint8Array(QR_PAYLOAD_LENGTH);
  bytes.set(encodeCertificate(payload.certificate), 0);
  bytes.set(encodeTimeWindow(payload.timeWindow), 126);
  bytes.set(checkLength("holderSig", payload.holderSig, SIGNATURE_LENGTH), 130);
  return bytes;
}

/** The text to put in the QR code (Base45, for the alphanumeric mode). */
export function encodeQr(payload: QrPayload): string {
  return encodeBase45(encodeQrPayload(payload));
}

function encodeFlags(fields: CertificateFields): number {
  const age = AGE_RATINGS.indexOf(fields.ageRating);
  if (age < 0) throw new RangeError(`ageRating: unknown value ${String(fields.ageRating)}`);
  if (fields.entryMode !== "single_use" && fields.entryMode !== "multi_scan") {
    throw new RangeError(`entryMode: unknown value ${String(fields.entryMode)}`);
  }
  return (
    (fields.entryMode === "multi_scan" ? FLAG_MULTI_SCAN : 0) |
    (age << AGE_SHIFT) |
    (fields.named ? FLAG_NAMED : 0)
  );
}

function checkInteger(name: string, value: number, min: number, max: number): number {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${name}: expected an integer from ${min} to ${max}, got ${value}`);
  }
  return value;
}

function checkLength(name: string, bytes: Uint8Array, length: number): Uint8Array {
  if (bytes.length !== length) {
    throw new RangeError(`${name}: expected ${length} bytes, got ${bytes.length}`);
  }
  return bytes;
}

function uuidToBytes(uuid: string): Uint8Array {
  if (!UUID_PATTERN.test(uuid)) throw new RangeError(`ticketId: expected a lowercase UUID`);
  const hex = uuid.replaceAll("-", "");
  const bytes = new Uint8Array(TICKET_ID_LENGTH);
  for (let i = 0; i < TICKET_ID_LENGTH; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

// ── Decoding ─────────────────────────────────────────────────────────────────
// Decoded byte fields are copies, never views of the input.

export function decodeCertificate(bytes: Uint8Array): DecodeResult<Certificate> {
  const error = checkFrame(bytes, CERTIFICATE_LENGTH);
  if (error) return { ok: false, error };
  return readCertificate(bytes);
}

export function decodeQrPayload(bytes: Uint8Array): DecodeResult<QrPayload> {
  const error = checkFrame(bytes, QR_PAYLOAD_LENGTH);
  if (error) return { ok: false, error };
  const certificate = readCertificate(bytes);
  if (!certificate.ok) return certificate;
  return {
    ok: true,
    value: {
      certificate: certificate.value,
      timeWindow: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(126),
      holderSig: bytes.slice(130, 194),
    },
  };
}

/** Decodes the text read from a QR code. */
export function decodeQr(text: string): DecodeResult<QrPayload> {
  const bytes = decodeBase45(text);
  if (bytes === null) return { ok: false, error: "invalid_base45" };
  return decodeQrPayload(bytes);
}

// The version comes first, so a future format of another length is reported as an
// unknown version rather than as a length error.
function checkFrame(bytes: Uint8Array, length: number): DecodeError | null {
  if (bytes.length === 0) return "too_short";
  if (bytes[0] !== CREDENTIAL_FORMAT_VERSION) return "unknown_version";
  if (bytes.length < length) return "too_short";
  if (bytes.length > length) return "trailing_bytes";
  return null;
}

// Reads bytes 0-125 of a frame already checked to be long enough.
function readCertificate(bytes: Uint8Array): DecodeResult<Certificate> {
  const flags = bytes[28] as number;
  if ((flags & RESERVED_MASK) !== 0) return { ok: false, error: "reserved_flags" };
  const ageRating = AGE_RATINGS[(flags & AGE_MASK) >> AGE_SHIFT];
  if (ageRating === undefined) return { ok: false, error: "invalid_age_rating" };
  const keyVersion = bytes[61] as number;
  if (keyVersion < MIN_KEY_VERSION) return { ok: false, error: "invalid_key_version" };
  return {
    ok: true,
    value: {
      fields: {
        serverKeyId: bytes[1] as number,
        ticketId: bytesToUuid(bytes.subarray(2, 18)),
        eventRef: bytes.slice(18, 26),
        typeRef: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(26),
        entryMode: (flags & FLAG_MULTI_SCAN) !== 0 ? "multi_scan" : "single_use",
        ageRating,
        named: (flags & FLAG_NAMED) !== 0,
        holderPubkey: bytes.slice(29, 61),
        keyVersion,
      },
      serverSig: bytes.slice(62, 126),
    },
  };
}

function bytesToUuid(bytes: Uint8Array): string {
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
