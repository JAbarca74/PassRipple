import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { bytesToUuid, uuidToBytes, uuidv7 } from "./uuid.ts";

describe("uuidToBytes", () => {
  test("manual lowercase UUID", () => {
    const u = "12345678-1234-1234-1234-123456789012";
    expect(bytesToUuid(uuidToBytes(u))).toBe(u);
  });

  test("round trips lowercase UUID", () => {
    fc.assert(
      fc.property(fc.uuid(), (uuid) => {
        expect(bytesToUuid(uuidToBytes(uuid))).toBe(uuid);
      }),
    );
  });

  test("rejects uppercase UUID", () => {
    fc.assert(
      fc.property(
        fc
          .uuid()
          .filter((u) => /[a-f]/.test(u))
          .map((u) => u.toUpperCase()),
        (uuid) => {
          expect(() => uuidToBytes(uuid)).toThrow(RangeError);
        },
      ),
    );
  });

  test("rejects incorrect length", () => {
    expect(() => uuidToBytes("12345678-1234-1234-1234-12345678901")).toThrow(RangeError);
    expect(() => uuidToBytes("12345678-1234-1234-1234-1234567890123")).toThrow(RangeError);
  });

  test("rejects non-UUID text", () => {
    expect(() => uuidToBytes("not-a-uuid-at-all")).toThrow(RangeError);
  });
});

describe("bytesToUuid", () => {
  test("rejects lengths other than 16", () => {
    expect(() => bytesToUuid(new Uint8Array(15))).toThrow(RangeError);
    expect(() => bytesToUuid(new Uint8Array(17))).toThrow(RangeError);
  });
});

describe("uuidv7", () => {
  test("creates a UUIDv7 from ms and random bytes", () => {
    const ms = 0x0189_7c4a_8b00;
    const random = new Uint8Array([0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xf0, 0x12, 0x34]);
    const uuid = uuidv7(ms, random);

    expect(uuid.startsWith("01897c4a-8b00-7")).toBe(true);
    // Version nibble is 7, variant is 10 (8, 9, a, b)
    expect(uuid.charAt(14)).toBe("7");
    expect(["8", "9", "a", "b"].includes(uuid.charAt(19))).toBe(true);
  });

  test("throws RangeError for invalid ms or random length", () => {
    const random = new Uint8Array(10);
    expect(() => uuidv7(-1, random)).toThrow(RangeError);
    expect(() => uuidv7(1.5, random)).toThrow(RangeError);
    expect(() => uuidv7(0x1_0000_0000_0000, random)).toThrow(RangeError); // > 2^48 - 1

    expect(() => uuidv7(0, new Uint8Array(9))).toThrow(RangeError);
    expect(() => uuidv7(0, new Uint8Array(11))).toThrow(RangeError);
  });

  test("properties: valid lowercase UUID, sorts by time", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 0xffff_ffff_ffff }),
        fc.uint8Array({ minLength: 10, maxLength: 10 }),
        (ms, random) => {
          const uuid = uuidv7(ms, random);
          expect(uuidToBytes(uuid).length).toBe(16); // accepts it
        },
      ),
    );

    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 0xffff_ffff_ffff - 1 }),
        fc.integer({ min: 1, max: 0xffff_ffff_ffff }),
        fc.uint8Array({ minLength: 10, maxLength: 10 }),
        fc.uint8Array({ minLength: 10, maxLength: 10 }),
        (msA, msB, randA, randB) => {
          const ms1 = Math.min(msA, msB);
          const ms2 = Math.max(msA, msB);
          fc.pre(ms1 < ms2);
          const u1 = uuidv7(ms1, randA);
          const u2 = uuidv7(ms2, randB);
          expect(u1 < u2).toBe(true);
        },
      ),
    );
  });
});
