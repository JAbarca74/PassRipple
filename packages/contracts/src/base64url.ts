// Base64url without padding (RFC 4648, section 5), for bytes inside JSON: public keys in the
// gate manifest. Decoding is canonical: it rejects padding, characters outside the
// alphabet, impossible lengths and non-zero trailing bits, so each byte string has exactly
// one text form.

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

const VALUES: ReadonlyMap<string, number> = new Map(
  Array.from(ALPHABET, (char, index) => [char, index] as const),
);

export function encodeBase64url(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0;
    const b = bytes[i + 1] ?? 0;
    const c = bytes[i + 2] ?? 0;
    const triple = (a << 16) | (b << 8) | c;
    const remaining = bytes.length - i;
    out += ALPHABET[(triple >> 18) & 63];
    out += ALPHABET[(triple >> 12) & 63];
    if (remaining > 1) out += ALPHABET[(triple >> 6) & 63];
    if (remaining > 2) out += ALPHABET[triple & 63];
  }
  return out;
}

/** The bytes of a canonical base64url text, or null if it is not one. */
export function decodeBase64url(text: string): Uint8Array | null {
  if (text.length % 4 === 1) return null;
  const out = new Uint8Array(Math.floor((text.length * 3) / 4));
  let written = 0;
  for (let i = 0; i < text.length; i += 4) {
    const chunk = text.slice(i, i + 4);
    let triple = 0;
    for (let j = 0; j < 4; j++) {
      const char = chunk[j];
      const value = char === undefined ? 0 : VALUES.get(char);
      if (value === undefined) return null;
      triple = (triple << 6) | value;
    }
    const bytes = chunk.length - 1;
    // Bits past the last whole byte must be zero, or two texts would share the same bytes.
    if (chunk.length === 2 && (triple & 0xffff) !== 0) return null;
    if (chunk.length === 3 && (triple & 0xff) !== 0) return null;
    out[written++] = (triple >> 16) & 0xff;
    if (bytes > 1) out[written++] = (triple >> 8) & 0xff;
    if (bytes > 2) out[written++] = triple & 0xff;
  }
  return out;
}
