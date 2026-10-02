import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { bytesToUuid, uuidToBytes } from "./uuid.ts";

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
      fc.property(fc.uuid().filter(u => /[a-f]/.test(u)).map(u => u.toUpperCase()), (uuid) => {
        expect(() => uuidToBytes(uuid)).toThrow(RangeError);
      }),
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
