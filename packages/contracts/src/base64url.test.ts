import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { decodeBase64url, encodeBase64url } from "./base64url.ts";

describe("base64url", () => {
  describe("encodeBase64url", () => {
    test("encodes RFC 4648 vectors without padding", () => {
      const encode = (s: string) =>
        encodeBase64url(new Uint8Array(s.split("").map((c) => c.charCodeAt(0))));
      expect(encode("")).toBe("");
      expect(encode("f")).toBe("Zg");
      expect(encode("fo")).toBe("Zm8");
      expect(encode("foo")).toBe("Zm9v");
      expect(encode("foob")).toBe("Zm9vYg");
      expect(encode("fooba")).toBe("Zm9vYmE");
      expect(encode("foobar")).toBe("Zm9vYmFy");
    });

    test("uses url alphabet", () => {
      expect(encodeBase64url(new Uint8Array([0xfb, 0xff]))).toBe("-_8");
    });
  });

  describe("decodeBase64url", () => {
    test("decodes RFC 4648 vectors", () => {
      const decode = (s: string) => {
        const out = decodeBase64url(s);
        if (!out) return null;
        return String.fromCharCode(...out);
      };
      expect(decode("")).toBe("");
      expect(decode("Zg")).toBe("f");
      expect(decode("Zm8")).toBe("fo");
      expect(decode("Zm9v")).toBe("foo");
      expect(decode("Zm9vYg")).toBe("foob");
      expect(decode("Zm9vYmE")).toBe("fooba");
      expect(decode("Zm9vYmFy")).toBe("foobar");
    });

    test("returns null for padding, invalid characters and spaces", () => {
      expect(decodeBase64url("Zg==")).toBeNull();
      expect(decodeBase64url("Zm8=")).toBeNull();
      expect(decodeBase64url("Z+8")).toBeNull();
      expect(decodeBase64url("Z/8")).toBeNull();
      expect(decodeBase64url("Z g")).toBeNull();
      expect(decodeBase64url(" Zg")).toBeNull();
      expect(decodeBase64url("Zg ")).toBeNull();
    });

    test("returns null for length % 4 === 1", () => {
      expect(decodeBase64url("Z")).toBeNull();
      expect(decodeBase64url("Zm9vY")).toBeNull();
    });

    test("returns null for non-zero trailing bits", () => {
      // "Zg" decodes to "f" (0x66). "Z" is 25 (011001), "g" is 32 (100000). 011001 100000 -> 01100110 0000.
      // "Zh" has "h" = 33 (100001). 011001 100001 -> 01100110 0001. Trailing bit is non-zero.
      expect(decodeBase64url("Zh")).toBeNull();
      // For a 3 character group, last character has 2 trailing bits.
      // "Zm8" -> "fo". "8" is 60 (111100). Trailing bits are 00.
      // "Zm9" -> "9" is 61 (111101). Trailing bits are 01.
      expect(decodeBase64url("Zm9")).toBeNull();
      // "-" is 62 (111110). Trailing bits 10.
      expect(decodeBase64url("Zm-")).toBeNull();
    });
  });

  describe("properties", () => {
    test("decode(encode(x)) === x", () => {
      fc.assert(
        fc.property(fc.uint8Array(), (bytes) => {
          expect(decodeBase64url(encodeBase64url(bytes))).toEqual(bytes);
        }),
      );
    });

    test("encode(decode(t)) === t for valid texts", () => {
      const validText = fc
        .uint8Array()
        .map(encodeBase64url)
        .filter((text) => decodeBase64url(text) !== null);
      
      fc.assert(
        fc.property(validText, (text) => {
          expect(encodeBase64url(decodeBase64url(text)!)).toBe(text);
        }),
      );
    });
  });
});
