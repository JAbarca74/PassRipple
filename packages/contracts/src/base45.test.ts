import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { decodeBase45, encodeBase45 } from "./base45.ts";

const utf8 = (text: string) => new TextEncoder().encode(text);

// Examples from RFC 9285, sections 4.3 and 4.4.
const RFC_9285 = [
  { text: "AB", base45: "BB8" },
  { text: "Hello!!", base45: "%69 VD92EX0" },
  { text: "base-45", base45: "UJCLQE7W581" },
  { text: "ietf!", base45: "QED8WEX0" },
];

describe("RFC 9285 examples", () => {
  test.each(RFC_9285)("$text ↔ $base45", ({ text, base45 }) => {
    expect(encodeBase45(utf8(text))).toBe(base45);
    expect(decodeBase45(base45)).toEqual(utf8(text));
  });
});

describe("encodeBase45", () => {
  test("encodes nothing as nothing", () => {
    expect(encodeBase45(new Uint8Array())).toBe("");
  });

  test("encodes the largest pair and the largest single byte", () => {
    expect(encodeBase45(new Uint8Array([0xff, 0xff]))).toBe("FGW");
    expect(encodeBase45(new Uint8Array([0xff]))).toBe("U5");
  });

  test("uses three characters per pair and two for a final odd byte", () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 300 }), (bytes) => {
        const length = Math.floor(bytes.length / 2) * 3 + (bytes.length % 2) * 2;
        expect(encodeBase45(bytes)).toHaveLength(length);
      }),
    );
  });
});

describe("decodeBase45", () => {
  test("round-trips any bytes", () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 300 }), (bytes) => {
        expect(decodeBase45(encodeBase45(bytes))).toEqual(bytes);
      }),
    );
  });

  test("accepts only the one encoding of each byte string", () => {
    const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:".split("");
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...alphabet), { maxLength: 30 }), (chars) => {
        const text = chars.join("");
        const bytes = decodeBase45(text);
        if (bytes !== null) expect(encodeBase45(bytes)).toBe(text);
      }),
    );
  });

  test("rejects a group above 65535 and a final pair above 255", () => {
    expect(decodeBase45("GGW")).toBeNull();
    expect(decodeBase45("V5")).toBeNull();
  });

  test("rejects a dangling single character", () => {
    expect(decodeBase45("A")).toBeNull();
    expect(decodeBase45("BB8A")).toBeNull();
  });

  test("rejects characters outside the alphabet, lowercase included", () => {
    expect(decodeBase45("bb8")).toBeNull();
    expect(decodeBase45("BB#")).toBeNull();
    expect(decodeBase45("B=")).toBeNull();
  });
});
