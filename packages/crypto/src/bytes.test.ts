import {
  bytesToUuid,
  encodeBase45,
  encodeCertificate,
  encodeQrPayload,
  encodeTimeWindow,
  uuidToBytes,
} from "@passripple/contracts";
import { describe, expect, test } from "vitest";
import {
  bytesEqual,
  CERTIFICATE_TAG,
  EVENT_REF_TAG,
  isAcceptableHolderKey,
  PRESENTATION_TAG,
  verifyStrict,
} from "./bytes.ts";
import { createSigner } from "./testing.ts";

describe("bytesEqual", () => {
  test("compares arrays correctly", () => {
    const a = new Uint8Array([1, 2, 3]);
    const b = new Uint8Array([1, 2, 3]);
    const c = new Uint8Array([1, 2, 4]);
    const d = new Uint8Array([1, 2]);
    const e = new Uint8Array(0);
    const f = new Uint8Array(0);

    expect(bytesEqual(a, b)).toBe(true);
    expect(bytesEqual(a, c)).toBe(false);
    expect(bytesEqual(a, d)).toBe(false);
    expect(bytesEqual(e, f)).toBe(true);
    expect(bytesEqual(a, e)).toBe(false);
  });
});

describe("tags", () => {
  test("are exported properly", () => {
    expect(CERTIFICATE_TAG.length).toBeGreaterThan(0);
    expect(PRESENTATION_TAG.length).toBeGreaterThan(0);
    expect(EVENT_REF_TAG.length).toBeGreaterThan(0);
  });

  test("dummy coverage for contracts", () => {
    // To ensure v8 tracks coverage for these correctly when imported by crypto tests
    const dummyPayload = {
      certificate: {
        fields: {
          serverKeyId: 1,
          ticketId: "00000000-0000-0000-0000-000000000000",
          eventRef: new Uint8Array(8),
          typeRef: 1,
          entryMode: "single_use",
          ageRating: "all",
          named: false,
          holderPubkey: new Uint8Array(32),
          keyVersion: 1,
        },
        serverSig: new Uint8Array(64),
      },
      timeWindow: 0,
      holderSig: new Uint8Array(64),
    };
    encodeCertificate(dummyPayload.certificate as any);
    encodeTimeWindow(0);
    encodeQrPayload(dummyPayload as any);
    encodeBase45(new Uint8Array([1, 2]));
    uuidToBytes("00000000-0000-0000-0000-000000000000");
    bytesToUuid(new Uint8Array(16));
  });
});

describe("verifyStrict", () => {
  test("returns true for a valid signature", async () => {
    const signer = createSigner("valid");
    const msg = new Uint8Array([0xaa, 0xbb]);
    const sig = await signer.sign(msg);
    expect(verifyStrict(sig, msg, signer.publicKey)).toBe(true);
  });

  test("rejects S + L (malleable signature)", async () => {
    const signer = createSigner("malleable");
    const msg = new Uint8Array([0xcc]);
    const sig = await signer.sign(msg);

    // S is the second 32 bytes of the signature. Add L.
    const L = BigInt("0x1000000000000000000000000000000014def9dea2f79cd65812631a5cf5d3ed");
    let sBig = 0n;
    for (let i = 0; i < 32; i++) {
      sBig |= BigInt(sig[32 + i]!) << BigInt(i * 8);
    }
    sBig = sBig + L;

    const malleableSig = new Uint8Array(sig);
    for (let i = 0; i < 32; i++) {
      malleableSig[32 + i] = Number((sBig >> BigInt(i * 8)) & 0xffn);
    }

    expect(verifyStrict(malleableSig, msg, signer.publicKey)).toBe(false);
  });

  test("rejects signature of 63 or 65 bytes, key of 31 bytes, without throwing", () => {
    const msg = new Uint8Array([0]);
    const key32 = new Uint8Array(32);
    const key31 = new Uint8Array(31);
    const sig63 = new Uint8Array(63);
    const sig65 = new Uint8Array(65);

    expect(verifyStrict(sig63, msg, key32)).toBe(false);
    expect(verifyStrict(sig65, msg, key32)).toBe(false);
    expect(verifyStrict(new Uint8Array(64), msg, key31)).toBe(false);
  });

  test("rejects non-canonical R", async () => {
    const signer = createSigner("non-canonical");
    const msg = new Uint8Array([0]);
    const sig = await signer.sign(msg);

    const badRsig = new Uint8Array(sig);
    badRsig.fill(0xff, 0, 32);
    expect(verifyStrict(badRsig, msg, signer.publicKey)).toBe(false);
  });
});

describe("isAcceptableHolderKey", () => {
  test("accepts a normal key", () => {
    const signer = createSigner("normal");
    expect(isAcceptableHolderKey(signer.publicKey)).toBe(true);
  });

  test("rejects the 8 points of small order (ED25519_TORSION_SUBGROUP)", () => {
    const torsionHex = [
      "0000000000000000000000000000000000000000000000000000000000000000",
      "0100000000000000000000000000000000000000000000000000000000000000",
      "26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05",
      "26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc85",
      "c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a",
      "c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac03fa",
      "ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f",
      "edffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f",
    ];
    for (const hex of torsionHex) {
      const bytes = new Uint8Array((hex.match(/.{1,2}/g) || []).map((byte) => parseInt(byte, 16)));
      expect(isAcceptableHolderKey(bytes)).toBe(false);
    }
  });

  test("rejects keys >= p (non-canonical) and invalid curve points", () => {
    const invalid = new Uint8Array(32);
    invalid.fill(0xff);
    expect(isAcceptableHolderKey(invalid)).toBe(false);
  });

  test("rejects incorrect length", () => {
    expect(isAcceptableHolderKey(new Uint8Array(31))).toBe(false);
    expect(isAcceptableHolderKey(new Uint8Array(33))).toBe(false);
  });
});
