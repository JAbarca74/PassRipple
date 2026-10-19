// The order's payment code, which the buyer writes in the SINPE description (10.2):
// five random Crockford Base32 characters and a Damm check character, like "K7NP9X"
// (ADR 0033). The check character lets reconciliation ignore any word of the description
// that is not a well-formed code, so a typo never matches another order by chance.

import { ALPHABET, damm, double, LOOKALIKES, VALUES } from "./crockford.ts";

const DATA_LENGTH = 5;
export const PAY_CODE_LENGTH = DATA_LENGTH + 1;
/** Random bytes a payment code needs: 32 bits, of which 25 are used. */
export const PAY_CODE_ENTROPY_BYTES = 4;
/** How many candidates a description may yield, at most. */
const MAX_CANDIDATES = 10;

/**
 * A new payment code from exactly 4 random bytes. The caller draws them with
 * crypto.getRandomValues; the database keeps codes unique and picks the first candidate
 * not taken.
 */
export function payCode(entropy: Uint8Array): string {
  if (entropy.length !== PAY_CODE_ENTROPY_BYTES) {
    throw new RangeError(`expected ${PAY_CODE_ENTROPY_BYTES} random bytes, got ${entropy.length}`);
  }
  // The top 25 of the 32 bits, as five 5-bit digits.
  let value = 0;
  for (const byte of entropy) value = value * 256 + byte;
  value = Math.floor(value / 128);
  const digits: number[] = [];
  for (let i = 0; i < DATA_LENGTH; i++) {
    digits.unshift(value % 32);
    value = Math.floor(value / 32);
  }
  digits.push(double(damm(digits)));
  return digits.map((digit) => ALPHABET[digit]).join("");
}

/** The canonical payment code a word reads as, or null. */
export function normalizePayCode(word: string): string | null {
  const chars = Array.from(word.toUpperCase(), (c) => LOOKALIKES[c] ?? c);
  if (chars.length !== PAY_CODE_LENGTH) return null;
  const digits: number[] = [];
  for (const char of chars) {
    const digit = VALUES.get(char);
    if (digit === undefined) return null;
    digits.push(digit);
  }
  return damm(digits) === 0 ? chars.join("") : null;
}

/**
 * The payment codes written in a payment description, in order and without repeats, at
 * most ten. The description is untrusted text from the payer: it is only split into words
 * of letters and digits, and each word is kept only if it is a well-formed code. Nothing
 * else in it is read.
 */
export function findPayCodes(description: string): string[] {
  const found: string[] = [];
  for (const word of description.slice(0, 500).split(/[^0-9A-Za-z]+/)) {
    const code = normalizePayCode(word);
    if (code !== null && !found.includes(code)) found.push(code);
    if (found.length === MAX_CANDIDATES) break;
  }
  return found;
}
