import { encodeBase64url } from "@passripple/contracts";
import { describe, expect, test } from "vitest";
import {
  docLast4,
  importDocKey,
  normalizeDocNumber,
  openDocNumber,
  sealDocNumber,
} from "./attendee-doc.ts";

const TICKET = "00000000-0000-4000-8000-000000000040";
const OTHER_TICKET = "00000000-0000-4000-8000-000000000041";
const rawKey = () => encodeBase64url(crypto.getRandomValues(new Uint8Array(32)));

describe("normalizeDocNumber", () => {
  test("accepts a cédula written with dashes or spaces", () => {
    expect(normalizeDocNumber("cedula", "1-2345-6789")).toBe("123456789");
    expect(normalizeDocNumber("tim", " 2 0345 0678 ")).toBe("203450678");
  });

  test("rejects a cédula of the wrong length or starting with 0", () => {
    expect(normalizeDocNumber("cedula", "12345678")).toBeNull();
    expect(normalizeDocNumber("cedula", "1234567890")).toBeNull();
    expect(normalizeDocNumber("cedula", "023456789")).toBeNull();
    expect(normalizeDocNumber("cedula", "12345678A")).toBeNull();
  });

  test("DIMEX has 11 or 12 digits", () => {
    expect(normalizeDocNumber("dimex", "155812345678")).toBe("155812345678");
    expect(normalizeDocNumber("dimex", "15581234567")).toBe("15581234567");
    expect(normalizeDocNumber("dimex", "1558123456")).toBeNull();
  });

  test("a passport has 6 to 20 letters and digits, in capitals", () => {
    expect(normalizeDocNumber("pasaporte", "ab-123456")).toBe("AB123456");
    expect(normalizeDocNumber("pasaporte", "A1234")).toBeNull();
    expect(normalizeDocNumber("pasaporte", "Ñ1234567")).toBeNull();
  });

  test("docLast4 keeps the last four characters", () => {
    expect(docLast4("123456789")).toBe("6789");
  });
});

describe("sealing the document number", () => {
  test("opens back for the same ticket", async () => {
    const key = await importDocKey(rawKey());
    const sealed = await sealDocNumber(key, TICKET, "123456789");
    expect(sealed.length).toBe(12 + 9 + 16);
    expect(new TextDecoder().decode(sealed)).not.toContain("123456789");
    await expect(openDocNumber(key, TICKET, sealed)).resolves.toBe("123456789");
  });

  test("uses a fresh nonce every time", async () => {
    const key = await importDocKey(rawKey());
    const a = await sealDocNumber(key, TICKET, "123456789");
    const b = await sealDocNumber(key, TICKET, "123456789");
    expect(encodeBase64url(a)).not.toBe(encodeBase64url(b));
  });

  test("does not open for another ticket, another key or altered bytes", async () => {
    const key = await importDocKey(rawKey());
    const sealed = await sealDocNumber(key, TICKET, "123456789");
    await expect(openDocNumber(key, OTHER_TICKET, sealed)).rejects.toThrow();
    await expect(openDocNumber(await importDocKey(rawKey()), TICKET, sealed)).rejects.toThrow();
    const altered = sealed.slice();
    altered[20] = (altered[20] ?? 0) ^ 1;
    await expect(openDocNumber(key, TICKET, altered)).rejects.toThrow();
  });

  test("the key must be 32 bytes of base64url", () => {
    expect(() => importDocKey("short")).toThrow("ATTENDEE_DOC_KEY");
    expect(() => importDocKey(encodeBase64url(new Uint8Array(16)))).toThrow("ATTENDEE_DOC_KEY");
  });
});
