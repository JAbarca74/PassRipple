// Crockford Base32 and the Damm check character shared by human codes (ADR 0015) and
// payment codes: a totally anti-symmetric quasigroup of order 32, x ∗ y = 2·x ⊕ y over
// GF(2⁵) with the polynomial x⁵ + x² + 1.

export const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const VALUES: ReadonlyMap<string, number> = new Map(
  Array.from(ALPHABET, (char, value) => [char, value]),
);
/** Crockford's reading rules for characters that look alike. */
export const LOOKALIKES: Readonly<Record<string, string>> = { O: "0", I: "1", L: "1" };

/** 2·x in GF(2⁵) modulo x⁵ + x² + 1. */
export function double(x: number): number {
  const shifted = x << 1;
  return shifted & 0b100000 ? shifted ^ 0b100101 : shifted;
}

/** Damm's interim value over a sequence of digits: 0 when the check digit is right. */
export function damm(digits: readonly number[]): number {
  let interim = 0;
  for (const digit of digits) interim = double(interim) ^ digit;
  return interim;
}
