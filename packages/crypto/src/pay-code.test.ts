import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { ALPHABET } from "./crockford.ts";
import {
  findPayCodes,
  normalizePayCode,
  PAY_CODE_ENTROPY_BYTES,
  PAY_CODE_LENGTH,
  payCode,
} from "./pay-code.ts";

describe("payCode", () => {
  test("returns expected vectors from calculated entropy", () => {
    expect(payCode(Uint8Array.of(0x00, 0x00, 0x00, 0x00))).toBe("000000");
    expect(payCode(Uint8Array.of(0xff, 0xff, 0xff, 0xff))).toBe("ZZZZZ1");
    expect(payCode(Uint8Array.of(0xff, 0xff, 0xff, 0x80))).toBe("ZZZZZ1");
    expect(payCode(Uint8Array.of(0xff, 0xff, 0xff, 0x81))).toBe("ZZZZZ1");
    expect(payCode(Uint8Array.of(0xff, 0xff, 0xff, 0x7f))).toBe("ZZZZY3");
    expect(payCode(Uint8Array.of(0x12, 0x34, 0x56, 0x78))).toBe("28T5CW");
  });

  test("throws RangeError on invalid entropy length and accepts exactly PAY_CODE_ENTROPY_BYTES", () => {
    expect(() => payCode(new Uint8Array(3))).toThrow(RangeError);
    expect(() => payCode(new Uint8Array(5))).toThrow(RangeError);
    expect(() => payCode(new Uint8Array(PAY_CODE_ENTROPY_BYTES))).not.toThrow();
  });

  test("property: for any 4 bytes, code has PAY_CODE_LENGTH characters of ALPHABET and normalizes to itself", () => {
    const alphabetSet = new Set(ALPHABET);
    fc.assert(
      fc.property(
        fc.uint8Array({ minLength: PAY_CODE_ENTROPY_BYTES, maxLength: PAY_CODE_ENTROPY_BYTES }),
        (entropy) => {
          const code = payCode(entropy);
          expect(code).toHaveLength(PAY_CODE_LENGTH);
          for (const char of code) {
            expect(alphabetSet.has(char)).toBe(true);
          }
          expect(normalizePayCode(code)).toBe(code);
        },
      ),
    );
  });
});

describe("normalizePayCode", () => {
  test("accepts lowercase characters", () => {
    expect(normalizePayCode("28t5cw")).toBe("28T5CW");
  });

  test("reads O as 0 and I/L as 1", () => {
    expect(normalizePayCode("OOOOOO")).toBe("000000");
    expect(normalizePayCode("ZZZZZI")).toBe("ZZZZZ1");
    expect(normalizePayCode("ZZZZZL")).toBe("ZZZZZ1");
  });

  test("returns null for invalid inputs, wrong lengths, non-alphabet characters, and invalid check digits", () => {
    expect(normalizePayCode("28T5CU")).toBeNull();
    expect(normalizePayCode("28T5C")).toBeNull();
    expect(normalizePayCode("28T5CWA")).toBeNull();
    expect(normalizePayCode("")).toBeNull();
    expect(normalizePayCode("K7NP9X")).toBeNull();
  });

  test("property: altering any character or swapping adjacent distinct characters yields null", () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ minLength: PAY_CODE_ENTROPY_BYTES, maxLength: PAY_CODE_ENTROPY_BYTES }),
        (entropy) => {
          const code = payCode(entropy);

          // Single character substitution with any other alphabet character
          for (let i = 0; i < code.length; i++) {
            for (let j = 0; j < ALPHABET.length; j++) {
              const char = ALPHABET[j];
              if (char !== code[i]) {
                const altered = code.substring(0, i) + char + code.substring(i + 1);
                expect(normalizePayCode(altered)).toBeNull();
              }
            }
          }

          // Swapping adjacent distinct characters
          for (let i = 0; i < code.length - 1; i++) {
            if (code[i] !== code[i + 1]) {
              const swapped = code.substring(0, i) + code[i + 1] + code[i] + code.substring(i + 2);
              expect(normalizePayCode(swapped)).toBeNull();
            }
          }
        },
      ),
    );
  });
});

describe("findPayCodes", () => {
  test("extracts pay codes without duplicates and preserves appearance order", () => {
    expect(findPayCodes("pago 28T5CW, gracias 28T5CW")).toEqual(["28T5CW"]);
    expect(findPayCodes("pago 28T5CW luego ZZZZZ1 y 000000")).toEqual([
      "28T5CW",
      "ZZZZZ1",
      "000000",
    ]);
  });

  test("returns at most the first 10 candidate codes when given 12 valid distinct codes", () => {
    const twelveCodes = Array.from({ length: 12 }, (_, i) =>
      payCode(Uint8Array.of(i + 1, 0, 0, 0)),
    );
    expect(new Set(twelveCodes).size).toBe(12);

    const text = twelveCodes.join(" ");
    expect(findPayCodes(text)).toEqual(twelveCodes.slice(0, 10));
  });

  test("ignores 6-character words with invalid check digits", () => {
    expect(findPayCodes("K7NP9X")).toEqual([]);
    expect(findPayCodes("referencia K7NP9X pago 28T5CW")).toEqual(["28T5CW"]);
  });

  test("ignores codes that start after character 500", () => {
    const text = `${"a".repeat(501)} 28T5CW`;
    expect(findPayCodes(text)).toEqual([]);
  });

  test("returns empty array for descriptions without valid codes or empty string", () => {
    expect(findPayCodes("este pago es de ₡50.000 y está aprobado")).toEqual([]);
    expect(findPayCodes("")).toEqual([]);
  });

  test("processes 1 MB of text in less than 100 ms", () => {
    const largeText = "este pago es de cincuenta mil colones ".repeat(30_000);
    expect(largeText.length).toBeGreaterThan(1_000_000);

    const start = performance.now();
    const result = findPayCodes(largeText);
    const duration = performance.now() - start;

    expect(result).toEqual([]);
    expect(duration).toBeLessThan(100);
  });
});
