import { describe, expect, test } from "vitest";
import {
  canonicalStaffCode,
  DEVICE_TOKEN_PREFIX,
  newSignInCode,
  newStaffCode,
  newToken,
  signInCodeHash,
  staffCodeHash,
  tokenHash,
  USER_TOKEN_PREFIX,
} from "./secrets.ts";

describe("tokens", () => {
  test("newToken creates a random 32 byte base64url token with prefix", () => {
    const u = newToken(USER_TOKEN_PREFIX);
    expect(u.startsWith(USER_TOKEN_PREFIX)).toBe(true);
    // 32 random bytes is 43 chars in base64url + prefix length
    expect(u.length).toBe(43 + USER_TOKEN_PREFIX.length);

    const d = newToken(DEVICE_TOKEN_PREFIX);
    expect(d.startsWith(DEVICE_TOKEN_PREFIX)).toBe(true);
  });

  test("tokenHash produces 32 byte SHA-256", async () => {
    const hash = await tokenHash("test");
    expect(hash).toBeInstanceOf(Uint8Array);
    expect(hash.length).toBe(32);

    const hash2 = await tokenHash("test");
    expect(hash).toEqual(hash2);

    const hash3 = await tokenHash("other");
    expect(hash).not.toEqual(hash3);
  });
});

describe("sign in codes", () => {
  test("newSignInCode generates 6 digits", () => {
    for (let i = 0; i < 50; i++) {
      const code = newSignInCode();
      expect(code).toMatch(/^[0-9]{6}$/);
    }
  });

  test("signInCodeHash produces 32 byte HMAC-SHA256", async () => {
    const pepper = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="; // 32 bytes in base64
    const h1 = await signInCodeHash(pepper, "test@example.com", "123456");
    const h2 = await signInCodeHash(pepper, "test@example.com", "123456");
    const h3 = await signInCodeHash(pepper, "other@example.com", "123456");
    const h4 = await signInCodeHash(pepper, "test@example.com", "999999");

    expect(h1).toBeInstanceOf(Uint8Array);
    expect(h1.length).toBe(32);
    expect(h1).toEqual(h2);
    expect(h1).not.toEqual(h3);
    expect(h1).not.toEqual(h4);
  });

  test("signInCodeHash throws if pepper is < 32 bytes", async () => {
    await expect(signInCodeHash("c2hvcnQ=", "a", "1")).rejects.toThrow(/at least 32 bytes/);
  });
});

describe("staff codes", () => {
  test("newStaffCode generates valid human code", () => {
    const code = newStaffCode();
    expect(code).toBeTypeOf("string");
    // we assume newStaffCode generates a canonical code via crypto package
    expect(canonicalStaffCode(code)).toBe(code);
  });

  test("canonicalStaffCode normalizes or rejects", () => {
    // "1" translates to "L", "0" to "O", etc in @passripple/crypto (crockford base32)
    // but here we just check it returns something or null
    expect(canonicalStaffCode("")).toBe(null);
  });

  test("staffCodeHash produces 32 byte HMAC-SHA256", async () => {
    const pepper = "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=";
    const h1 = await staffCodeHash(pepper, "ABC");
    const h2 = await staffCodeHash(pepper, "ABC");
    const h3 = await staffCodeHash(pepper, "DEF");

    expect(h1).toBeInstanceOf(Uint8Array);
    expect(h1.length).toBe(32);
    expect(h1).toEqual(h2);
    expect(h1).not.toEqual(h3);
  });
});
