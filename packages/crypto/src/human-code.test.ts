import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { formatHumanCode, humanCode, normalizeHumanCode, validateHumanCode } from "./human-code.ts";

describe("humanCode", () => {
  test("returns expected vectors", () => {
    expect(humanCode(Uint8Array.of(1, 2, 3, 4, 5, 6))).toBe("041061050Z");

    const zeros = new Uint8Array(6);
    expect(humanCode(zeros)).toBe("0000000000");

    const ones = new Uint8Array(6);
    ones.fill(0xff);
    expect(humanCode(ones)).toBe("ZZZZZZZZZX");
  });

  test("throws on invalid entropy length", () => {
    expect(() => humanCode(new Uint8Array(5))).toThrow(RangeError);
    expect(() => humanCode(new Uint8Array(7))).toThrow(RangeError);
  });
});

describe("humanCode properties", () => {
  test("generated code is valid and canonical", () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 6, maxLength: 6 }), (entropy) => {
        const code = humanCode(entropy);
        expect(normalizeHumanCode(code)).toBe(code);
        expect(validateHumanCode(code)).toBe(true);
      }),
    );
  });

  const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

  test("all single character substitutions and neighbor swaps invalidate the code", () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 6, maxLength: 6 }), (entropy) => {
        const code = humanCode(entropy);

        // Single substitution
        for (let i = 0; i < code.length; i++) {
          for (let j = 0; j < ALPHABET.length; j++) {
            const char = ALPHABET[j];
            if (char !== code[i]) {
              const altered = code.substring(0, i) + char + code.substring(i + 1);
              expect(validateHumanCode(altered)).toBe(false);
            }
          }
        }

        // Neighbor swaps
        for (let i = 0; i < code.length - 1; i++) {
          if (code[i] !== code[i + 1]) {
            const altered = code.substring(0, i) + code[i + 1] + code[i] + code.substring(i + 2);
            expect(validateHumanCode(altered)).toBe(false);
          }
        }
      }),
    );
  });
});

describe("normalizeHumanCode and validateHumanCode", () => {
  test("accepts hyphens, spaces, lowercase, O->0, I->1, L->1", () => {
    const validCanonical = humanCode(Uint8Array.of(1, 2, 3, 4, 5, 6)); // 041061050Z

    // Check modifications
    const input = " o 4 i 0 6 l 0 5 0 z -  ";
    expect(normalizeHumanCode(input)).toBe(validCanonical);
    expect(validateHumanCode(input)).toBe(true);
  });

  test("rejects U, other symbols, wrong length, bad check digit", () => {
    const valid = humanCode(Uint8Array.of(1, 2, 3, 4, 5, 6)); // 041061050Z

    // U
    expect(normalizeHumanCode(valid.replace("Z", "U"))).toBe(null);
    expect(validateHumanCode(valid.replace("Z", "U"))).toBe(false);

    // Other symbols
    expect(normalizeHumanCode(valid.replace("Z", "!"))).toBe(null);

    // Wrong length
    expect(normalizeHumanCode(valid + "0")).toBe(null);
    expect(normalizeHumanCode(valid.substring(0, 9))).toBe(null);

    // Bad check digit
    expect(normalizeHumanCode(valid.substring(0, 9) + "Y")).toBe(null);
  });
});

describe("formatHumanCode", () => {
  test("formats valid code", () => {
    const valid = humanCode(Uint8Array.of(1, 2, 3, 4, 5, 6)); // 041061050Z
    expect(formatHumanCode(valid)).toBe("04106-1050Z");
  });

  test("throws on invalid code", () => {
    expect(() => formatHumanCode("invalid code!")).toThrow(RangeError);
  });
});
