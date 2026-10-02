import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { signCertificate } from "./certificate.ts";
import { timeWindow, presentCredential, verifyCredential, WINDOW_MS, WINDOW_TOLERANCE } from "./credential.ts";
import { createServerSigner, createSigner } from "./testing.ts";
import { encodeQrPayload, decodeBase45, encodeBase45, MAX_TIME_WINDOW } from "@passripple/contracts";
import { ed25519 } from "@noble/curves/ed25519.js";

describe("timeWindow", () => {
  test("returns correct windows", () => {
    expect(timeWindow(0)).toBe(0);
    expect(timeWindow(WINDOW_MS - 1)).toBe(0);
    expect(timeWindow(WINDOW_MS)).toBe(1);
    expect(timeWindow(MAX_TIME_WINDOW * WINDOW_MS)).toBe(MAX_TIME_WINDOW);
  });

  test("throws on invalid times", () => {
    expect(() => timeWindow(NaN)).toThrow(RangeError);
    expect(() => timeWindow(Infinity)).toThrow(RangeError);
    expect(() => timeWindow(-1)).toThrow(RangeError);
    expect(() => timeWindow((MAX_TIME_WINDOW + 1) * WINDOW_MS)).toThrow(RangeError);
  });
});

describe("presentCredential", () => {
  const holder = createSigner("holder");
  const server = createServerSigner("server", 42);
  const input = {
    ticketId: "12345678-1234-1234-1234-123456789012",
    eventId: "87654321-4321-4321-4321-210987654321",
    typeRef: 1,
    entryMode: "single_use" as const,
    ageRating: "all" as const,
    named: false,
    holderPubkey: holder.publicKey,
    keyVersion: 1,
  };

  test("returns a QR of 291 characters", async () => {
    const cert = await signCertificate(input, server);
    const qr = await presentCredential(cert, holder, 0);
    expect(qr).toHaveLength(291);
  });

  test("throws if signer does not have the certificate key", async () => {
    const cert = await signCertificate(input, server);
    const otherHolder = createSigner("other");
    await expect(presentCredential(cert, otherHolder, 0)).rejects.toThrow();
  });

  test("throws if device signature does not verify", async () => {
    const cert = await signCertificate(input, server);
    const badSigner = { ...holder, sign: async () => new Uint8Array(64) }; // Returns all zeros
    await expect(presentCredential(cert, badSigner, 0)).rejects.toThrow();
  });
});

describe("verifyCredential", () => {
  const holder = createSigner("holder");
  const server = createServerSigner("server", 42);
  const serverKeys = new Map([[42, server.publicKey]]);
  const eventId = "87654321-4321-4321-4321-210987654321";
  const context = { serverKeys, eventId };
  
  const input = {
    ticketId: "12345678-1234-1234-1234-123456789012",
    eventId,
    typeRef: 1,
    entryMode: "single_use" as const,
    ageRating: "all" as const,
    named: false,
    holderPubkey: holder.publicKey,
    keyVersion: 1,
  };

  async function getValidQr(nowMs: number = 0) {
    const cert = await signCertificate(input, server);
    return presentCredential(cert, holder, nowMs);
  }

  test("malformed (all details)", async () => {
    const validQr = await getValidQr();
    const bytes = decodeBase45(validQr)!;

    // invalid_base45
    expect(verifyCredential("NOT BASE45!!!", context, 0)).toEqual({ ok: false, reason: "malformed", detail: "invalid_base45" });
    
    // too_short (empty)
    expect(verifyCredential(encodeBase45(new Uint8Array(0)), context, 0)).toEqual({ ok: false, reason: "malformed", detail: "too_short" });
    
    // unknown_version
    const vBytes = new Uint8Array(bytes);
    vBytes[0] = 99;
    expect(verifyCredential(encodeBase45(vBytes), context, 0)).toEqual({ ok: false, reason: "malformed", detail: "unknown_version" });

    // trailing_bytes
    const tBytes = new Uint8Array(bytes.length + 1);
    tBytes.set(bytes);
    expect(verifyCredential(encodeBase45(tBytes), context, 0)).toEqual({ ok: false, reason: "malformed", detail: "trailing_bytes" });

    // reserved_flags
    const fBytes = new Uint8Array(bytes);
    fBytes[28] = fBytes[28]! | 0x10; // set a reserved bit
    expect(verifyCredential(encodeBase45(fBytes), context, 0)).toEqual({ ok: false, reason: "malformed", detail: "reserved_flags" });

    // invalid_age_rating
    const aBytes = new Uint8Array(bytes);
    aBytes[28] = aBytes[28]! | (3 << 1); // unknown age rating (3)
    expect(verifyCredential(encodeBase45(aBytes), context, 0)).toEqual({ ok: false, reason: "malformed", detail: "invalid_age_rating" });

    // invalid_key_version
    const kBytes = new Uint8Array(bytes);
    kBytes[61] = 0;
    expect(verifyCredential(encodeBase45(kBytes), context, 0)).toEqual({ ok: false, reason: "malformed", detail: "invalid_key_version" });
  });

  test("unknown_server_key", async () => {
    const qr = await getValidQr();
    expect(verifyCredential(qr, { serverKeys: new Map(), eventId }, 0)).toEqual({ ok: false, reason: "unknown_server_key" });
  });

  test("bad_server_signature", async () => {
    const qr = await getValidQr();
    const bytes = decodeBase45(qr)!;
    bytes[62] = bytes[62]! ^ 1; // alter serverSig
    expect(verifyCredential(encodeBase45(bytes), context, 0)).toEqual({ ok: false, reason: "bad_server_signature" });
  });

  test("weak_holder_key", async () => {
    const smallOrder = new Uint8Array(32); // weak key
    // We must bypass signCertificate since it rejects weak keys
    const certFields = { ...input, serverKeyId: 42, holderPubkey: smallOrder, eventRef: new Uint8Array(8) };
    const { encodeCertificateBody, encodeQr } = require("@passripple/contracts");
    const { certificateMessage } = require("./certificate.ts");
    const body = encodeCertificateBody(certFields);
    const serverSig = await server.sign(certificateMessage(body));
    const cert = { fields: certFields, serverSig };
    
    const weakHolder = { publicKey: smallOrder, sign: async () => new Uint8Array(64) }; // fake sig because verify doesn't even reach there
    // also bypass presentCredential which rejects bad sigs
    // Just build the payload manually
    const timeWindowVal = timeWindow(0);
    const { concatBytes } = require("@noble/hashes/utils.js");
    const { encodeTimeWindow } = require("@passripple/contracts");
    const { PRESENTATION_TAG } = require("./bytes.ts");
    
    // We don't even need a valid device sig, weak_holder_key is checked first
    const holderSig = new Uint8Array(64);
    const qr = encodeQr({ certificate: cert, timeWindow: timeWindowVal, holderSig });

    expect(verifyCredential(qr, context, 0)).toEqual({ ok: false, reason: "weak_holder_key" });
  });

  test("bad_holder_signature", async () => {
    const qr = await getValidQr();
    const bytes = decodeBase45(qr)!;
    bytes[130] = bytes[130]! ^ 1; // alter holderSig
    expect(verifyCredential(encodeBase45(bytes), context, 0)).toEqual({ ok: false, reason: "bad_holder_signature" });
  });

  test("stale_window and future_window", async () => {
    const qr = await getValidQr(1000 * WINDOW_MS);
    expect(verifyCredential(qr, context, (1000 + 3) * WINDOW_MS).ok).toBe(false); // Stale
    expect(verifyCredential(qr, context, (1000 + 3) * WINDOW_MS)).toEqual({ ok: false, reason: "stale_window" });
    
    expect(verifyCredential(qr, context, (1000 - 3) * WINDOW_MS).ok).toBe(false); // Future
    expect(verifyCredential(qr, context, (1000 - 3) * WINDOW_MS)).toEqual({ ok: false, reason: "future_window" });
  });

  test("wrong_event", async () => {
    const qr = await getValidQr();
    expect(verifyCredential(qr, { serverKeys, eventId: "11111111-1111-1111-1111-111111111111" }, 0)).toEqual({ ok: false, reason: "wrong_event" });
  });

  test("window offsets", async () => {
    const baseWindow = 1000;
    const qr = await getValidQr(baseWindow * WINDOW_MS);
    
    for (let offset = -WINDOW_TOLERANCE; offset <= WINDOW_TOLERANCE; offset++) {
      const nowMs = (baseWindow - offset) * WINDOW_MS;
      const v = verifyCredential(qr, context, nowMs);
      expect(v.ok).toBe(true);
      if (v.ok) expect(v.windowOffset).toBe(offset);
    }
    
    // Edges of the current window
    const nowMsExact = baseWindow * WINDOW_MS;
    const vStart = verifyCredential(qr, context, nowMsExact);
    expect(vStart.ok).toBe(true);
    if (vStart.ok) expect(vStart.windowOffset).toBe(0);

    const vEnd = verifyCredential(qr, context, nowMsExact + WINDOW_MS - 1);
    expect(vEnd.ok).toBe(true);
    if (vEnd.ok) expect(vEnd.windowOffset).toBe(0);
  });

  test("reason precedence: signatures over time/event", async () => {
    const qr = await getValidQr(0); // Window 0
    const bytes = decodeBase45(qr)!;
    
    // Alter holder signature and check with old window
    const badSigBytes = new Uint8Array(bytes);
    badSigBytes[130] = badSigBytes[130]! ^ 1;
    const res1 = verifyCredential(encodeBase45(badSigBytes), context, 5 * WINDOW_MS);
    expect(res1).toEqual({ ok: false, reason: "bad_holder_signature" });
    
    // Alter server signature and check with old window
    const badServerSigBytes = new Uint8Array(bytes);
    badServerSigBytes[62] = badServerSigBytes[62]! ^ 1;
    const res2 = verifyCredential(encodeBase45(badServerSigBytes), context, 5 * WINDOW_MS);
    expect(res2).toEqual({ ok: false, reason: "bad_server_signature" });

    // Correct signatures, but wrong event AND old window
    const wrongEventContext = { serverKeys, eventId: "11111111-1111-1111-1111-111111111111" };
    const res3 = verifyCredential(qr, wrongEventContext, 5 * WINDOW_MS);
    expect(res3).toEqual({ ok: false, reason: "stale_window" }); // Time checked before event
  });
});

describe("fast-check properties", () => {
  const holder = createSigner("holder");
  const server = createServerSigner("server", 42);
  const serverKeys = new Map([[42, server.publicKey]]);
  const eventId = "87654321-4321-4321-4321-210987654321";
  const context = { serverKeys, eventId };

  test("presentation and verification round trip", async () => {
    const cert = await signCertificate({
      ticketId: "12345678-1234-1234-1234-123456789012",
      eventId,
      typeRef: 1,
      entryMode: "single_use" as const,
      ageRating: "all" as const,
      named: false,
      holderPubkey: holder.publicKey,
      keyVersion: 1,
    }, server);

    const qr = await presentCredential(cert, holder, 0);
    const verdict = verifyCredential(qr, context, 0);
    expect(verdict.ok).toBe(true);
    if (verdict.ok) {
      expect(verdict.credential.ticketId).toBe("12345678-1234-1234-1234-123456789012");
      expect(verdict.credential.keyVersion).toBe(1);
      expect(verdict.windowOffset).toBe(0);
    }
  });

  test("mutating any byte of the payload makes it invalid", async () => {
    const cert = await signCertificate({
      ticketId: "12345678-1234-1234-1234-123456789012",
      eventId,
      typeRef: 1,
      entryMode: "single_use" as const,
      ageRating: "all" as const,
      named: false,
      holderPubkey: holder.publicKey,
      keyVersion: 1,
    }, server);

    const qr = await presentCredential(cert, holder, 0);
    const bytes = decodeBase45(qr)!;

    fc.assert(
      fc.property(fc.integer({ min: 0, max: bytes.length - 1 }), fc.integer({ min: 1, max: 255 }), (pos, diff) => {
        const altered = new Uint8Array(bytes);
        altered[pos] = altered[pos]! ^ diff;
        expect(verifyCredential(encodeBase45(altered), context, 0).ok).toBe(false);
      }),
    );
  });

  test("mutating any base45 character makes it invalid", async () => {
    const cert = await signCertificate({
      ticketId: "12345678-1234-1234-1234-123456789012",
      eventId,
      typeRef: 1,
      entryMode: "single_use" as const,
      ageRating: "all" as const,
      named: false,
      holderPubkey: holder.publicKey,
      keyVersion: 1,
    }, server);

    const qr = await presentCredential(cert, holder, 0);

    const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";
    fc.assert(
      fc.property(fc.integer({ min: 0, max: qr.length - 1 }), fc.integer({ min: 1, max: alphabet.length - 1 }), (pos, diff) => {
        const alteredChars = qr.split("");
        const origChar = alteredChars[pos]!;
        const origIdx = alphabet.indexOf(origChar);
        const newChar = alphabet[(origIdx + diff) % alphabet.length]!;
        alteredChars[pos] = newChar;
        const alteredQr = alteredChars.join("");
        
        expect(verifyCredential(alteredQr, context, 0).ok).toBe(false);
      }),
    );
  });
});

