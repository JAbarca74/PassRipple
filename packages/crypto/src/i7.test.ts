import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { concatBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import {
  decodeBase45,
  decodeQrPayload,
  encodeBase45,
  encodeCertificateBody,
  encodeQr,
  encodeQrPayload,
  encodeTimeWindow,
} from "@passripple/contracts";
import fc from "fast-check";
import { beforeAll, describe, expect, test } from "vitest";
import { PRESENTATION_TAG } from "./bytes.ts";
import { certificateMessage, eventRef, signCertificate } from "./certificate.ts";
import {
  presentCredential,
  timeWindow,
  verifyCredential,
  WINDOW_MS,
  WINDOW_TOLERANCE,
} from "./credential.ts";
import { humanCode } from "./human-code.ts";
import { createServerSigner, createSigner } from "./testing.ts";

// Invariant I7: No validator can forge a valid credential
describe("I7: Attacker cannot forge credentials", () => {
  const eventIdA = "11111111-1111-1111-1111-111111111111";
  const eventIdB = "22222222-2222-2222-2222-222222222222";

  const server1 = createServerSigner("server1", 1);
  const server2 = createServerSigner("server2", 2);
  const retiredServer = createServerSigner("server3", 3);

  const serverKeys = new Map([
    [1, server1.publicKey],
    [2, server2.publicKey],
  ]);

  const attacker = createSigner("attacker");

  const buyers: ReturnType<typeof createSigner>[] = [];
  for (let i = 0; i < 10; i++) buyers.push(createSigner(`buyer-${i}`));

  // Fixture states
  const manifests = new Map<string, any>();
  const credentials = new Map<string, string>(); // ticketId -> qr
  const certificates = new Map<string, any>(); // ticketId -> certificate

  const nowMs = 1000 * WINDOW_MS;

  beforeAll(async () => {
    const buildManifest = async (eventId: string, ticketCount: number) => {
      const tickets = [];
      for (let i = 0; i < ticketCount; i++) {
        const ticketId = `00000000-0000-4000-8000-${eventId.split("-")[0]!.substring(0, 8)}${i.toString(16).padStart(4, "0")}`;
        const buyer = buyers[i % buyers.length]!;

        // Use crypto.subtle in tests? The requirements say:
        // "No uses crypto.getRandomValues fuera de archivos *.test.ts"
        // Let's use a deterministic fake entropy for the tests so it's reproducible.
        const entropy = sha256(utf8ToBytes(`entropy-${ticketId}`)).slice(0, 6);
        const code = humanCode(entropy);

        const certInput = {
          ticketId,
          eventId,
          typeRef: (i % 5) + 1,
          entryMode: "single_use" as const,
          ageRating: "all" as const,
          named: false,
          holderPubkey: buyer.publicKey,
          keyVersion: 1,
        };

        const signerToUse = i % 2 === 0 ? server1 : server2;
        const cert = await signCertificate(certInput, signerToUse);
        certificates.set(ticketId, cert);

        const qr = await presentCredential(cert, buyer, nowMs);
        credentials.set(ticketId, qr);

        tickets.push({
          ticketId,
          typeRef: certInput.typeRef,
          entryMode: certInput.entryMode,
          status: "bound",
          redeemed: false,
          holderPubkey: buyer!.publicKey,
          keyVersion: 1,
          codeHuman: code,
        });
      }

      return {
        formatVersion: 1,
        eventId,
        expiresAt: "2030-01-01T00:00:00Z",
        serverKeys: [
          { id: 1, publicKey: server1.publicKey },
          { id: 2, publicKey: server2.publicKey },
        ],
        tickets,
      };
    };

    manifests.set(eventIdA, await buildManifest(eventIdA, 200));
    manifests.set(eventIdB, await buildManifest(eventIdB, 10));
  });

  function getCtx(eventId: string = eventIdA) {
    return { serverKeys, eventId };
  }

  test("a) signing with manifest data as a private key and attacker's key", async () => {
    const manifest = manifests.get(eventIdA)!;
    const ticket = manifest.tickets[0];
    const cert = certificates.get(ticket.ticketId);

    // Attacker tries to use a piece of data from the manifest as a seed
    const attackerSeeds = [
      ticket.holderPubkey,
      cert.serverSig,
      utf8ToBytes(ticket.codeHuman),
      sha256(cert.serverSig),
      sha256(ticket.holderPubkey),
    ];

    for (const seed of attackerSeeds) {
      // pad or slice to 32 bytes
      const actualSeed = new Uint8Array(32);
      actualSeed.set(seed.slice(0, 32));

      const fakeSigner = {
        publicKey: ed25519.getPublicKey(actualSeed),
        sign: async (msg: Uint8Array) => ed25519.sign(msg, actualSeed),
      };

      // Tries to present it
      // presentCredential would fail since fakeSigner.publicKey !== cert.holderPubkey
      // so we build it manually

      const window = timeWindow(nowMs);
      const msg = concatBytes(
        PRESENTATION_TAG,
        encodeCertificateBody(cert.fields),
        encodeTimeWindow(window),
      );
      const holderSig = await fakeSigner.sign(msg);
      const qr = encodeQr({ certificate: cert, timeWindow: window, holderSig });

      // Verifying should fail because the holder key in the cert doesn't match the signature,
      // or the signature is invalid for the key in the cert.
      expect(verifyCredential(qr, getCtx(), nowMs).ok).toBe(false);
    }
  });

  test("b) reusing server_sig as holder_sig", () => {
    const ticketId = manifests.get(eventIdA)!.tickets[0].ticketId;
    const qr = credentials.get(ticketId)!;
    const bytes = decodeBase45(qr)!;

    // Copy server_sig (bytes 62 to 126) into holder_sig (bytes 130 to 194)
    const serverSig = bytes.slice(62, 126);
    bytes.set(serverSig, 130);

    expect(verifyCredential(encodeBase45(bytes), getCtx(), nowMs).ok).toBe(false);
  });

  test("c) changing time_window of captured QR", () => {
    const ticketId = manifests.get(eventIdA)!.tickets[0].ticketId;
    const qr = credentials.get(ticketId)!;
    const originalBytes = decodeBase45(qr)!;
    const view = new DataView(
      originalBytes.buffer,
      originalBytes.byteOffset,
      originalBytes.byteLength,
    );
    const originalWindow = view.getUint32(126);

    for (let offset = -1000; offset <= 1000; offset++) {
      if (offset === 0) continue;
      const forgedWindow = originalWindow + offset;
      if (forgedWindow < 0) continue;
      const forgedBytes = new Uint8Array(originalBytes);
      new DataView(forgedBytes.buffer, forgedBytes.byteOffset, forgedBytes.byteLength).setUint32(
        126,
        forgedWindow,
      );
      const forgedQr = encodeBase45(forgedBytes);

      expect(verifyCredential(forgedQr, getCtx(), nowMs).ok).toBe(false);
    }
  }, 30000);

  test("d) changing holder_pubkey to attacker's key", async () => {
    const ticketId = manifests.get(eventIdA)!.tickets[0].ticketId;
    const qr = credentials.get(ticketId)!;
    const bytes = decodeBase45(qr)!;

    // Bytes 29 to 61 are holderPubkey
    bytes.set(attacker.publicKey, 29);

    // The attacker can sign the new window
    const body = bytes.subarray(0, 62);
    const windowBytes = bytes.subarray(126, 130);
    const msg = concatBytes(PRESENTATION_TAG, body, windowBytes);
    const fakeHolderSig = await attacker.sign(msg);
    bytes.set(fakeHolderSig, 130);

    // But verifyCredential will fail at bad_server_signature
    const res = verifyCredential(encodeBase45(bytes), getCtx(), nowMs);
    expect(res).toEqual({ ok: false, reason: "bad_server_signature" });
  });

  test("e) altering key_version, ticket_id, event_ref, type_ref, or flags", () => {
    const ticketId = manifests.get(eventIdA)!.tickets[0].ticketId;
    const qr = credentials.get(ticketId)!;
    const bytes = decodeBase45(qr)!;

    const testOffsets = [
      { name: "ticket_id", offset: 2 },
      { name: "event_ref", offset: 18 },
      { name: "type_ref", offset: 26 },
      { name: "flags", offset: 28 },
      { name: "key_version", offset: 61 },
    ];

    for (const testCase of testOffsets) {
      const alteredBytes = new Uint8Array(bytes);
      alteredBytes[testCase.offset] = alteredBytes[testCase.offset]! ^ 1; // alter 1 bit
      const res = verifyCredential(encodeBase45(alteredBytes), getCtx(), nowMs);
      expect(res.ok).toBe(false);
      // Depending on the field, it could be a malformed or bad_server_signature
    }
  });

  test("f) mixing certificates and signatures from the same device", async () => {
    // Find two tickets belonging to the same buyer
    const manifest = manifests.get(eventIdA)!;
    const ticket1 = manifest.tickets[0];
    const ticket2 = manifest.tickets.find(
      (t: any) =>
        t.ticketId !== ticket1.ticketId &&
        Buffer.from(t.holderPubkey).equals(Buffer.from(ticket1.holderPubkey)),
    );

    const qr1 = credentials.get(ticket1.ticketId)!;
    const qr2 = credentials.get(ticket2.ticketId)!;

    const bytes1 = decodeBase45(qr1)!;
    const bytes2 = decodeBase45(qr2)!;

    // Swap holder_sig: cert of 1 with sig of 2
    const forgedBytes = new Uint8Array(bytes1);
    forgedBytes.set(bytes2.subarray(130, 194), 130);

    const res = verifyCredential(encodeBase45(forgedBytes), getCtx(), nowMs);
    expect(res).toEqual({ ok: false, reason: "bad_holder_signature" });
  });

  test("g) presenting a credential of event A in event B", () => {
    const ticketIdA = manifests.get(eventIdA)!.tickets[0].ticketId;
    const qrA = credentials.get(ticketIdA)!;

    const res = verifyCredential(qrA, getCtx(eventIdB), nowMs);
    expect(res).toEqual({ ok: false, reason: "wrong_event" });
  });

  test("h) signed with retired key or attacker pretending to be a valid id", async () => {
    const certInput = {
      ticketId: "12345678-1234-1234-1234-123456789012",
      eventId: eventIdA,
      typeRef: 1,
      entryMode: "single_use" as const,
      ageRating: "all" as const,
      named: false,
      holderPubkey: buyers[0]!.publicKey,
      keyVersion: 1,
    };

    // Retired key
    const certRetired = await signCertificate(certInput, retiredServer);
    const qrRetired = await presentCredential(certRetired, buyers[0]!, nowMs);
    const resRetired = verifyCredential(qrRetired, getCtx(), nowMs);
    expect(resRetired).toEqual({ ok: false, reason: "unknown_server_key" });

    // Attacker using server1's ID (1)
    const attackerServer = { ...attacker, keyId: 1 };
    const fields = {
      serverKeyId: 1,
      ticketId: certInput.ticketId,
      eventRef: eventRef(certInput.eventId),
      typeRef: certInput.typeRef,
      entryMode: certInput.entryMode,
      ageRating: certInput.ageRating,
      named: certInput.named,
      holderPubkey: certInput.holderPubkey,
      keyVersion: certInput.keyVersion,
    };
    const body = encodeCertificateBody(fields);
    const serverSig = await attackerServer.sign(certificateMessage(body));
    const certAttacker = { fields, serverSig };
    const qrAttacker = await presentCredential(certAttacker as any, buyers[0]!, nowMs);

    const resAttacker = verifyCredential(qrAttacker, getCtx(), nowMs);
    expect(resAttacker).toEqual({ ok: false, reason: "bad_server_signature" });
  });

  test("i) malleable signatures (S+L) and non-canonical encodings", async () => {
    const ticketId = manifests.get(eventIdA)!.tickets[0].ticketId;
    const qr = credentials.get(ticketId)!;
    const bytes = decodeBase45(qr)!;

    // Add L to S in holder signature
    const L = BigInt("0x1000000000000000000000000000000014def9dea2f79cd65812631a5cf5d3ed");
    let sBig = 0n;
    for (let i = 0; i < 32; i++) {
      sBig |= BigInt(bytes[130 + 32 + i]!) << BigInt(i * 8);
    }
    sBig = sBig + L;

    const malleableBytes = new Uint8Array(bytes);
    for (let i = 0; i < 32; i++) {
      malleableBytes[130 + 32 + i] = Number((sBig >> BigInt(i * 8)) & 0xffn);
    }

    const res = verifyCredential(encodeBase45(malleableBytes), getCtx(), nowMs);
    expect(res).toEqual({ ok: false, reason: "bad_holder_signature" });
  });

  test("j) fast-check: random mutations of bytes and characters", () => {
    const ticketId = manifests.get(eventIdA)!.tickets[0].ticketId;
    const qr = credentials.get(ticketId)!;
    const bytes = decodeBase45(qr)!;
    const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";

    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: bytes.length - 1 }),
        fc.integer({ min: 1, max: 255 }),
        (pos, diff) => {
          const alteredBytes = new Uint8Array(bytes);
          alteredBytes[pos] = alteredBytes[pos]! ^ diff;
          expect(verifyCredential(encodeBase45(alteredBytes), getCtx(), nowMs).ok).toBe(false);
        },
      ),
    );

    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: qr.length - 1 }),
        fc.integer({ min: 1, max: alphabet.length - 1 }),
        (pos, diff) => {
          const alteredChars = qr.split("");
          const origIdx = alphabet.indexOf(alteredChars[pos]!);
          alteredChars[pos] = alphabet[(origIdx + diff) % alphabet.length]!;
          expect(verifyCredential(alteredChars.join(""), getCtx(), nowMs).ok).toBe(false);
        },
      ),
    );
  });

  // Verify behavior that is INTENTIONALLY ACCEPTED
  describe("Valid behaviors that rely on the Gate checking the Manifest (I1 and Step 4)", () => {
    test("accepts the same exact QR repeated within ±2 windows (Gate checks manifest for single-use / I1)", () => {
      // Reason: Crypto validates the keys and signature, but the gate prevents replay attacks
      // by marking the ticket as 'redeemed' in the manifest.
      const ticketId = manifests.get(eventIdA)!.tickets[0].ticketId;
      const qr = credentials.get(ticketId)!;

      const res1 = verifyCredential(qr, getCtx(), nowMs);
      expect(res1.ok).toBe(true);

      const res2 = verifyCredential(qr, getCtx(), nowMs + WINDOW_MS);
      expect(res2.ok).toBe(true);
    });

    test("accepts a perfectly valid certificate of a previous key_version (Gate checks manifest for version)", async () => {
      // Reason: The certificate was signed by a valid server key and presented by the valid holder
      // AT THE TIME. However, the ticket was since bound to a new key. The Gate will reject it
      // when it compares the keyVersion returned by crypto with the one in the Manifest.
      const buyerOld = buyers[0];
      const certOld = certificates.get(manifests.get(eventIdA)!.tickets[0].ticketId);
      const qrOld = await presentCredential(certOld, buyerOld!, nowMs);

      // Now the ticket gets rebound to buyer[1] (key_version 2)
      // The old QR still passes crypto verification
      const res = verifyCredential(qrOld, getCtx(), nowMs);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.credential.keyVersion).toBe(1);
      }
    });
  });
});
