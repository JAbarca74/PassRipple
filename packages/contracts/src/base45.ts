// Base45 (RFC 9285): binary data as text for the alphanumeric mode of a QR code.
// Every two bytes become three characters, and a final odd byte becomes two.

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";

const VALUES: ReadonlyMap<string, number> = new Map(
  Array.from(ALPHABET, (char, value) => [char, value]),
);

/** Encodes bytes as Base45 text. */
export function encodeBase45(bytes: Uint8Array): string {
  let text = "";
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    let n = (bytes[i] as number) * 256 + (bytes[i + 1] as number);
    for (let k = 0; k < 3; k++) {
      text += ALPHABET[n % 45];
      n = Math.floor(n / 45);
    }
  }
  if (bytes.length % 2 === 1) {
    const n = bytes[bytes.length - 1] as number;
    text += (ALPHABET[n % 45] as string) + ALPHABET[Math.floor(n / 45)];
  }
  return text;
}

/**
 * Decodes Base45 text, or returns null if it is not valid Base45: a character outside the
 * alphabet (lowercase included), a dangling single character, or a group whose value does
 * not fit its bytes. Every byte string has exactly one valid encoding.
 */
export function decodeBase45(text: string): Uint8Array | null {
  if (text.length % 3 === 1) return null;
  const bytes = new Uint8Array(Math.floor(text.length / 3) * 2 + (text.length % 3 === 2 ? 1 : 0));
  let out = 0;
  for (let i = 0; i < text.length; i += 3) {
    const group = text.slice(i, i + 3);
    let n = 0;
    for (let k = group.length - 1; k >= 0; k--) {
      const value = VALUES.get(group[k] as string);
      if (value === undefined) return null;
      n = n * 45 + value;
    }
    if (group.length === 3) {
      if (n > 0xffff) return null;
      bytes[out++] = n >> 8;
      bytes[out++] = n & 0xff;
    } else {
      if (n > 0xff) return null;
      bytes[out++] = n;
    }
  }
  return bytes;
}
