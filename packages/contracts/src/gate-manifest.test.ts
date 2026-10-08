import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { encodeBase64url } from "./base64url.ts";
import {
  decodeGateManifest,
  decodeGateManifestDelta,
  decodeServerKeys,
  encodeGateManifest,
  encodeGateManifestDelta,
  GATE_MANIFEST_VERSION,
  manifestCursor,
  type GateManifest,
  type GateManifestDelta,
} from "./gate-manifest.ts";

describe("gate-manifest", () => {
  test("has GATE_MANIFEST_VERSION = 1", () => {
    expect(GATE_MANIFEST_VERSION).toBe(1);
  });

  const validManifestBase = {
    formatVersion: GATE_MANIFEST_VERSION as const,
    eventId: "12345678-1234-1234-1234-123456789012",
    event: {
      name: "Test Event",
      venueName: "Venue",
      startsAt: "2024-01-01T12:00:00Z",
      endsAt: "2024-01-01T23:00:00Z",
      ageRating: "all" as const,
    },
    deviceZone: "Zone 1",
    expiresAt: "2024-01-02T12:00:00Z",
    serverKeys: [],
    ticketTypes: [],
    tickets: [],
    cursor: "123",
    serverTime: 1700000000000,
  };

  const validManifest = { ...validManifestBase };

  describe("encodeGateManifest and decodeGateManifest", () => {
    test("are inverses for valid generated manifests", () => {
      const manifestArb = fc.record({
        formatVersion: fc.constant(1 as const),
        eventId: fc.uuid(),
        event: fc.record({
          name: fc.string({ minLength: 1 }),
          venueName: fc.string({ minLength: 1 }),
          startsAt: fc.date().map((d) => d.toISOString()),
          endsAt: fc.date().map((d) => d.toISOString()),
          ageRating: fc.constantFrom("all" as const, "12plus" as const, "18plus" as const),
        }),
        deviceZone: fc.string({ minLength: 1 }),
        expiresAt: fc.date().map((d) => d.toISOString()),
        serverKeys: fc.array(
          fc.record({
            id: fc.integer({ min: 0, max: 255 }),
            publicKey: fc.uint8Array({ minLength: 32, maxLength: 32 }),
          })
        ),
        ticketTypes: fc.array(
          fc.record({
            ref: fc.integer({ min: 1, max: 65535 }),
            name: fc.string({ minLength: 1 }),
            zone: fc.string({ minLength: 1 }),
            entryMode: fc.constantFrom("single_use" as const, "multi_scan" as const),
            audience: fc.constantFrom("public" as const, "staff" as const, "performer" as const),
          })
        ),
        tickets: fc.array(
          fc.record({
            ticketId: fc.uuid(),
            typeRef: fc.integer({ min: 1, max: 65535 }),
            entryMode: fc.constantFrom("single_use" as const, "multi_scan" as const),
            status: fc.constantFrom("issued" as const, "bound" as const, "void" as const),
            redeemed: fc.boolean(),
            holderPubkey: fc.option(fc.uint8Array({ minLength: 32, maxLength: 32 }), { nil: null }),
            keyVersion: fc.integer({ min: 0, max: 255 }),
            codeHuman: fc.stringOf(fc.constantFrom(..."0123456789ABCDEFGHJKMNPTVWXYZ"), { minLength: 10, maxLength: 10 }),
          })
        ),
        cursor: fc.stringOf(fc.constantFrom(..."0123456789"), { minLength: 1, maxLength: 20 }),
        serverTime: fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
      });

      fc.assert(
        fc.property(manifestArb, (manifest) => {
          expect(decodeGateManifest(encodeGateManifest(manifest))).toEqual(manifest);
        })
      );
    });

    test("decode returns null for various invalid inputs", () => {
      // Valid baseline encoded
      const encoded: any = encodeGateManifest(validManifest);

      // Key not 32 bytes
      expect(decodeGateManifest({ ...encoded, serverKeys: [{ id: 1, publicKey: encodeBase64url(new Uint8Array(31)) }] })).toBeNull();
      // Key not base64url canonical (e.g. padded)
      expect(decodeGateManifest({ ...encoded, serverKeys: [{ id: 1, publicKey: "A".repeat(43) + "=" }] })).toBeNull();

      // ticketId uppercase
      expect(decodeGateManifest({ ...encoded, tickets: [{ ticketId: "12345678-1234-1234-1234-12345678901A", typeRef: 1, entryMode: "single_use", status: "issued", redeemed: false, holderPubkey: null, keyVersion: 1, codeHuman: "0123456789" }] })).toBeNull();

      // codeHuman invalid length or invalid chars (I, L, O, U)
      const ticketBase = { ticketId: validManifestBase.eventId, typeRef: 1, entryMode: "single_use", status: "issued", redeemed: false, holderPubkey: null, keyVersion: 1 };
      expect(decodeGateManifest({ ...encoded, tickets: [{ ...ticketBase, codeHuman: "012345678" }] })).toBeNull(); // len 9
      expect(decodeGateManifest({ ...encoded, tickets: [{ ...ticketBase, codeHuman: "012345678I" }] })).toBeNull(); // I
      expect(decodeGateManifest({ ...encoded, tickets: [{ ...ticketBase, codeHuman: "012345678L" }] })).toBeNull(); // L
      expect(decodeGateManifest({ ...encoded, tickets: [{ ...ticketBase, codeHuman: "012345678O" }] })).toBeNull(); // O
      expect(decodeGateManifest({ ...encoded, tickets: [{ ...ticketBase, codeHuman: "012345678U" }] })).toBeNull(); // U

      // cursor not digits or more than 20
      expect(decodeGateManifest({ ...encoded, cursor: "-1" })).toBeNull();
      expect(decodeGateManifest({ ...encoded, cursor: "123456789012345678901" })).toBeNull(); // 21 digits

      // formatVersion 2
      expect(decodeGateManifest({ ...encoded, formatVersion: 2 })).toBeNull();

      // keyVersion 256
      expect(decodeGateManifest({ ...encoded, tickets: [{ ...ticketBase, codeHuman: "0123456789", keyVersion: 256 }] })).toBeNull();

      // typeRef 0
      expect(decodeGateManifest({ ...encoded, tickets: [{ ...ticketBase, codeHuman: "0123456789", typeRef: 0 }] })).toBeNull();

      // status redeemed (not in the enum)
      expect(decodeGateManifest({ ...encoded, tickets: [{ ...ticketBase, codeHuman: "0123456789", status: "redeemed" }] })).toBeNull();

      // missing event
      const { event, ...noEvent } = encoded;
      expect(decodeGateManifest(noEvent)).toBeNull();

      // missing deviceZone
      const { deviceZone, ...noDeviceZone } = encoded;
      expect(decodeGateManifest(noDeviceZone)).toBeNull();
    });
  });

  describe("decodeGateManifestDelta", () => {
    test("requires since and does not require event or deviceZone", () => {
      const validDelta: GateManifestDelta = {
        formatVersion: GATE_MANIFEST_VERSION,
        eventId: validManifest.eventId,
        since: "100",
        expiresAt: validManifest.expiresAt,
        serverKeys: [],
        ticketTypes: [],
        tickets: [],
        cursor: "200",
        serverTime: validManifest.serverTime,
      };

      const encoded = encodeGateManifestDelta(validDelta);
      const decoded = decodeGateManifestDelta(encoded);
      expect(decoded).toEqual(validDelta);

      // if since missing, null
      const { since, ...noSince } = encoded as any;
      expect(decodeGateManifestDelta(noSince)).toBeNull();
    });
  });

  describe("decodeServerKeys", () => {
    test("accepts valid key ring", () => {
      const ring = [{ id: 1, publicKey: encodeBase64url(new Uint8Array(32)) }];
      const decoded = decodeServerKeys(ring);
      expect(decoded).toBeDefined();
      expect(decoded![0].id).toBe(1);
      expect(decoded![0].publicKey.length).toBe(32);
    });

    test("returns null for invalid key rings", () => {
      const pk32 = encodeBase64url(new Uint8Array(32));
      const pk31 = encodeBase64url(new Uint8Array(31));
      
      // Repeated ids
      expect(decodeServerKeys([{ id: 1, publicKey: pk32 }, { id: 1, publicKey: pk32 }])).toBeNull();
      
      // id 256
      expect(decodeServerKeys([{ id: 256, publicKey: pk32 }])).toBeNull();
      
      // key of 31 bytes
      expect(decodeServerKeys([{ id: 1, publicKey: pk31 }])).toBeNull();
      
      // not an array
      expect(decodeServerKeys({ id: 1, publicKey: pk32 })).toBeNull();
    });
  });

  describe("manifestCursor", () => {
    test("accepts valid cursors", () => {
      expect(manifestCursor.parse("0")).toBe("0");
      expect(manifestCursor.parse("12345678901234567890")).toBe("12345678901234567890");
    });

    test("rejects invalid cursors", () => {
      expect(() => manifestCursor.parse("")).toThrow();
      expect(() => manifestCursor.parse("-1")).toThrow();
      expect(() => manifestCursor.parse("1e3")).toThrow();
      expect(() => manifestCursor.parse("123456789012345678901")).toThrow();
    });
  });
});
