// Attendees' identity documents (design 7.2, 7.5). The number is checked and normalized
// here, encrypted with AES-256-GCM bound to its ticket, and only then stored. Gate devices
// get the last digits, never the number.

import { decodeBase64url } from "@passripple/contracts";

export const DOC_TYPES = ["cedula", "dimex", "pasaporte", "tim"] as const;
export type DocType = (typeof DOC_TYPES)[number];

const NONCE_LENGTH = 12;
const encoder = new TextEncoder();

/**
 * The document number without spaces or dashes, in capitals, or null when it does not look
 * like one of its type: a cédula or a TIM has 9 digits (1-2345-6789), a DIMEX 11 or 12, a
 * passport 6 to 20 letters and digits.
 */
export function normalizeDocNumber(type: DocType, raw: string): string | null {
  const value = raw.replace(/[\s.-]/g, "").toUpperCase();
  const valid =
    type === "cedula" || type === "tim"
      ? /^[1-9][0-9]{8}$/.test(value)
      : type === "dimex"
        ? /^[0-9]{11,12}$/.test(value)
        : /^[0-9A-Z]{6,20}$/.test(value);
  return valid ? value : null;
}

/** The last four characters, what the gate shows next to the name. */
export function docLast4(normalized: string): string {
  return normalized.slice(-4);
}

/** Imports ATTENDEE_DOC_KEY, or throws when it is not 32 bytes of base64url. */
export function importDocKey(raw: string): Promise<CryptoKey> {
  const bytes = decodeBase64url(raw);
  if (bytes === null || bytes.length !== 32) {
    throw new Error("ATTENDEE_DOC_KEY must be 32 bytes in base64url");
  }
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** nonce || ciphertext, with the ticket's id as associated data. */
export async function sealDocNumber(
  key: CryptoKey,
  ticketId: string,
  normalized: string,
): Promise<Uint8Array> {
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_LENGTH));
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce, additionalData: encoder.encode(ticketId) },
      key,
      encoder.encode(normalized),
    ),
  );
  const out = new Uint8Array(NONCE_LENGTH + sealed.length);
  out.set(nonce);
  out.set(sealed, NONCE_LENGTH);
  return out;
}

/** The number back, for the ticket it was sealed for. Throws if it was altered or moved. */
export async function openDocNumber(
  key: CryptoKey,
  ticketId: string,
  sealed: Uint8Array,
): Promise<string> {
  const plain = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: sealed.subarray(0, NONCE_LENGTH),
      additionalData: encoder.encode(ticketId),
    },
    key,
    sealed.subarray(NONCE_LENGTH),
  );
  return new TextDecoder().decode(plain);
}
