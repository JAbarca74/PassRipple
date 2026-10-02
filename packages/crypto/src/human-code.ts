// The static fallback code an operator types when the camera cannot read a QR (6.7):
// nine random Crockford Base32 characters and a Damm check character, shown as
// "4K7NP-9XR2M" (ADR 0015).
//
// The check character uses a totally anti-symmetric quasigroup of order 32,
// x ∗ y = 2·x ⊕ y over GF(2⁵) with the polynomial x⁵ + x² + 1, so it catches every
// single wrong character and every swap of two adjacent characters.

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const VALUES: ReadonlyMap<string, number> = new Map(
  Array.from(ALPHABET, (char, value) => [char, value]),
);
// Crockford's reading rules for characters that look alike.
const LOOKALIKES: Readonly<Record<string, string>> = { O: "0", I: "1", L: "1" };

const DATA_LENGTH = 9;
export const HUMAN_CODE_LENGTH = DATA_LENGTH + 1;
/** Random bytes a code needs: 48 bits, of which 45 are used. */
export const HUMAN_CODE_ENTROPY_BYTES = 6;

/** 2·x in GF(2⁵) modulo x⁵ + x² + 1. */
function double(x: number): number {
  const shifted = x << 1;
  return shifted & 0b100000 ? shifted ^ 0b100101 : shifted;
}

/** Damm's interim value over a sequence of digits: 0 when the check digit is right. */
function damm(digits: readonly number[]): number {
  let interim = 0;
  for (const digit of digits) interim = double(interim) ^ digit;
  return interim;
}

/**
 * A new human code, in canonical form (10 characters, no hyphen), from exactly 6 random
 * bytes. The caller draws them with crypto.getRandomValues and retries if the code is
 * already taken. 32 is a power of 2, so every code is equally likely.
 */
export function humanCode(entropy: Uint8Array): string {
  if (entropy.length !== HUMAN_CODE_ENTROPY_BYTES) {
    throw new RangeError(
      `expected ${HUMAN_CODE_ENTROPY_BYTES} random bytes, got ${entropy.length}`,
    );
  }
  // The top 45 of the 48 bits, as nine 5-bit digits.
  let value = 0;
  for (const byte of entropy) value = value * 256 + byte;
  value = Math.floor(value / 8);
  const digits: number[] = [];
  for (let i = 0; i < DATA_LENGTH; i++) {
    digits.unshift(value % 32);
    value = Math.floor(value / 32);
  }
  // The check digit c makes the interim 0: 2·interim ⊕ c = 0, so c = 2·interim.
  digits.push(double(damm(digits)));
  return digits.map((digit) => ALPHABET[digit]).join("");
}

/**
 * The canonical form of a code as typed, or null if it is not a valid code. Hyphens and
 * spaces are ignored, lowercase is accepted, and O reads as 0 and I or L as 1. U is not
 * part of the alphabet.
 */
export function normalizeHumanCode(input: string): string | null {
  const chars = Array.from(input.toUpperCase().replace(/[-\s]/g, ""), (c) => LOOKALIKES[c] ?? c);
  if (chars.length !== HUMAN_CODE_LENGTH) return null;
  const digits: number[] = [];
  for (const char of chars) {
    const digit = VALUES.get(char);
    if (digit === undefined) return null;
    digits.push(digit);
  }
  return damm(digits) === 0 ? chars.join("") : null;
}

/** Whether the input, as typed, is a valid code. */
export function validateHumanCode(input: string): boolean {
  return normalizeHumanCode(input) !== null;
}

/** A code as shown to people: two groups of five, "4K7NP-9XR2M". Throws if invalid. */
export function formatHumanCode(code: string): string {
  const canonical = normalizeHumanCode(code);
  if (canonical === null) throw new RangeError("not a valid human code");
  return `${canonical.slice(0, 5)}-${canonical.slice(5)}`;
}
