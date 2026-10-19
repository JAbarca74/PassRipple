// Random tokens, one-time codes and the hashes the database stores instead of them. Only
// the Worker ever sees a token or a code; the database keeps their SHA-256 (tokens, 256
// random bits) or a keyed HMAC (codes, too short to survive a plain hash).

import { ORDER_TOKEN_PREFIX } from "@passripple/contracts";
import {
  HUMAN_CODE_ENTROPY_BYTES,
  humanCode,
  normalizeHumanCode,
  PAY_CODE_ENTROPY_BYTES,
  payCode,
} from "@passripple/crypto";

/** Prefix of a person's session token. */
export const USER_TOKEN_PREFIX = "pru_";
/** Prefix of a gate device's session token. */
export const DEVICE_TOKEN_PREFIX = "prd_";

const encoder = new TextEncoder();

function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(length));
}

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text.replaceAll("-", "+").replaceAll("_", "/"));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(text)));
}

/** A new bearer token: 32 random bytes after a prefix that says what kind it is. */
export function newToken(prefix: string): string {
  return prefix + base64url(randomBytes(32));
}

/** What the database stores for a token. */
export function tokenHash(token: string): Promise<Uint8Array> {
  return sha256(token);
}

/** Six uniformly random digits. */
export function newSignInCode(): string {
  // Rejection sampling: 4 294 000 000 is the largest multiple of 10^6 below 2^32.
  for (;;) {
    const [value] = crypto.getRandomValues(new Uint32Array(1));
    if (value !== undefined && value < 4_294_000_000) {
      return String(value % 1_000_000).padStart(6, "0");
    }
  }
}

/** A new staff code, in the human code format (ADR 0015): ten characters with a check. */
export function newStaffCode(): string {
  return humanCode(randomBytes(HUMAN_CODE_ENTROPY_BYTES));
}

/** The canonical staff code as typed, or null if it cannot be one. */
export function canonicalStaffCode(typed: string): string | null {
  return normalizeHumanCode(typed);
}

const hmacKeys = new Map<string, Promise<CryptoKey>>();

function hmacKey(pepper: string): Promise<CryptoKey> {
  let key = hmacKeys.get(pepper);
  if (!key) {
    const raw = fromBase64(pepper);
    if (raw.length < 32) throw new Error("SIGN_IN_PEPPER must hold at least 32 bytes");
    key = crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    hmacKeys.set(pepper, key);
  }
  return key;
}

/** HMAC-SHA256 over a domain tag and NUL-separated parts, so no two messages collide. */
async function keyedHash(
  pepper: string,
  tag: string,
  parts: readonly string[],
): Promise<Uint8Array> {
  const message = encoder.encode([tag, ...parts].join("\u0000"));
  return new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(pepper), message));
}

/** What the database stores for a sign-in code: bound to the address it was sent to. */
export function signInCodeHash(pepper: string, email: string, code: string): Promise<Uint8Array> {
  return keyedHash(pepper, "PassRipple/sign-in/v1", [email, code]);
}

/** What the database stores for a staff code, in canonical form. */
export function staffCodeHash(pepper: string, canonicalCode: string): Promise<Uint8Array> {
  return keyedHash(pepper, "PassRipple/staff-code/v1", [canonicalCode]);
}

/**
 * An order's access token, derived from the browser's idempotency key with the server's
 * key (ADR 0033): a checkout retried with the same key gets the same token back, although
 * the database keeps only its SHA-256. Whoever holds the key already holds the token.
 */
export async function orderToken(pepper: string, idempotencyKey: string): Promise<string> {
  const mac = await keyedHash(pepper, "PassRipple/order-token/v1", [idempotencyKey]);
  return ORDER_TOKEN_PREFIX + base64url(mac);
}

/** Candidates for an order's payment code; the database takes the first one free. */
export function newPayCodes(count: number): string[] {
  return Array.from({ length: count }, () => payCode(randomBytes(PAY_CODE_ENTROPY_BYTES)));
}
