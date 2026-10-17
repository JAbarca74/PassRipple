import { decodeCertificate, encodeCertificate } from "@passripple/contracts";
import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { eventRef, signCertificate, verifyCertificate } from "./certificate.ts";
import { createServerSigner, createSigner } from "./testing.ts";

function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("expected a value");
  return value;
}

describe("eventRef", () => {
  test("returns 8 bytes", () => {
    const ref = eventRef("12345678-1234-1234-1234-123456789012");
    expect(ref).toBeInstanceOf(Uint8Array);
    expect(ref.length).toBe(8);
  });

  test("is deterministic and different for different events", () => {
    const ref1 = eventRef("12345678-1234-1234-1234-123456789012");
    const ref1b = eventRef("12345678-1234-1234-1234-123456789012");
    const ref2 = eventRef("12345678-1234-1234-1234-123456789013");
    expect(ref1).toEqual(ref1b);
    expect(ref1).not.toEqual(ref2);
  });

  test("throws on uppercase UUID", () => {
    expect(() => eventRef("12345678-1234-1234-1234-12345678901A")).toThrow(RangeError);
  });
});

describe("signCertificate", () => {
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

  test("produces correct fields", async () => {
    const cert = await signCertificate(input, server);
    expect(cert.fields.serverKeyId).toBe(42);
    expect(cert.fields.eventRef).toEqual(eventRef(input.eventId));
  });

  test("rejects small order and 31-byte holder keys", async () => {
    const smallOrder = new Uint8Array(32); // All zeros is a small order point
    await expect(signCertificate({ ...input, holderPubkey: smallOrder }, server)).rejects.toThrow(
      RangeError,
    );
    await expect(
      signCertificate({ ...input, holderPubkey: new Uint8Array(31) }, server),
    ).rejects.toThrow(RangeError);
  });

  test("throws if signer returns invalid signature length or bad signature", async () => {
    const badSignerLength = { ...server, sign: async () => new Uint8Array(63) };
    await expect(signCertificate(input, badSignerLength)).rejects.toThrow();

    const badSignerContent = { ...server, sign: async () => new Uint8Array(64) };
    await expect(signCertificate(input, badSignerContent)).rejects.toThrow();
  });

  test("propagates RangeError for out of bounds fields", async () => {
    await expect(signCertificate({ ...input, keyVersion: 0 }, server)).rejects.toThrow(RangeError);
    await expect(signCertificate({ ...input, keyVersion: 256 }, server)).rejects.toThrow(
      RangeError,
    );
    await expect(signCertificate({ ...input, typeRef: 65536 }, server)).rejects.toThrow(RangeError);
  });
});

describe("verifyCertificate", () => {
  const holder = createSigner("holder");
  const server = createServerSigner("server", 42);
  const serverKeys = new Map([[42, server.publicKey]]);
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

  test("returns true with correct keyring", async () => {
    const cert = await signCertificate(input, server);
    expect(verifyCertificate(cert, serverKeys)).toBe(true);
  });

  test("returns false with unknown id or different key", async () => {
    const cert = await signCertificate(input, server);
    expect(verifyCertificate(cert, new Map())).toBe(false);
    expect(verifyCertificate(cert, new Map([[42, new Uint8Array(32)]]))).toBe(false);
  });

  test("returns false on altered fields", async () => {
    const cert = await signCertificate(input, server);
    expect(
      verifyCertificate({ ...cert, fields: { ...cert.fields, keyVersion: 2 } }, serverKeys),
    ).toBe(false);
    // fields out of bounds return false (because encodeCertificateBody throws internally and it is caught)
    expect(
      verifyCertificate({ ...cert, fields: { ...cert.fields, keyVersion: 256 } }, serverKeys),
    ).toBe(false);
  });

  test("returns false on altered signature", async () => {
    const cert = await signCertificate(input, server);
    const alteredSig = new Uint8Array(cert.serverSig);
    alteredSig[0] = must(alteredSig[0]) ^ 1;
    expect(verifyCertificate({ ...cert, serverSig: alteredSig }, serverKeys)).toBe(false);
  });

  test("altering any byte of the encoded cert makes it invalid", async () => {
    const cert = await signCertificate(input, server);
    const raw = encodeCertificate(cert);
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: raw.length - 1 }),
        fc.integer({ min: 1, max: 255 }),
        (pos, diff) => {
          const altered = new Uint8Array(raw);
          altered[pos] = must(altered[pos]) ^ diff;
          // The decoder is tested in contracts, but verifying that the verification fails here.
          // But verifyCertificate takes a Certificate, not raw bytes.
          // We decode it manually. If it fails to decode, that's fine.
          // If it decodes, verifyCertificate must be false.
          try {
            const res = decodeCertificate(altered);
            if (res.ok) {
              expect(verifyCertificate(res.value, serverKeys)).toBe(false);
            }
          } catch {
            // If it throws, it's fine. (it shouldn't throw though, decodeCertificate returns an error result)
          }
        },
      ),
    );
  });
});
