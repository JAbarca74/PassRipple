import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { encodeBase45 } from "./base45.ts";
import {
  CERTIFICATE_BODY_LENGTH,
  CERTIFICATE_LENGTH,
  type Certificate,
  type CertificateFields,
  decodeCertificate,
  decodeQr,
  decodeQrPayload,
  encodeCertificate,
  encodeCertificateBody,
  encodeQr,
  encodeQrPayload,
  encodeTimeWindow,
  QR_PAYLOAD_LENGTH,
  type QrPayload,
} from "./credential-format.ts";

const bytesArb = (length: number) => fc.uint8Array({ minLength: length, maxLength: length });

const fieldsArb: fc.Arbitrary<CertificateFields> = fc.record({
  serverKeyId: fc.integer({ min: 0, max: 255 }),
  ticketId: fc.uuid({ version: [1, 2, 3, 4, 5, 6, 7, 8] }).map((id) => id.toLowerCase()),
  eventRef: bytesArb(8),
  typeRef: fc.integer({ min: 0, max: 0xffff }),
  entryMode: fc.constantFrom("single_use", "multi_scan"),
  ageRating: fc.constantFrom("all", "12plus", "18plus"),
  named: fc.boolean(),
  holderPubkey: bytesArb(32),
  keyVersion: fc.integer({ min: 1, max: 255 }),
});

const certificateArb: fc.Arbitrary<Certificate> = fc.record({
  fields: fieldsArb,
  serverSig: bytesArb(64),
});

const payloadArb: fc.Arbitrary<QrPayload> = fc.record({
  certificate: certificateArb,
  timeWindow: fc.integer({ min: 0, max: 0xffffffff }),
  holderSig: bytesArb(64),
});

const FIELDS: CertificateFields = {
  serverKeyId: 7,
  ticketId: "0192f0c4-1b2a-4c3d-8e4f-5a6b7c8d9e0f",
  eventRef: Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]),
  typeRef: 0x0102,
  entryMode: "multi_scan",
  ageRating: "18plus",
  named: true,
  holderPubkey: new Uint8Array(32).fill(0xaa),
  keyVersion: 3,
};
const PAYLOAD: QrPayload = {
  certificate: { fields: FIELDS, serverSig: new Uint8Array(64).fill(0xbb) },
  timeWindow: 0x01020304,
  holderSig: new Uint8Array(64).fill(0xcc),
};

/** The payload's bytes with some of them replaced. */
function payloadWith(changes: Record<number, number>): Uint8Array {
  const bytes = encodeQrPayload(PAYLOAD);
  for (const [offset, value] of Object.entries(changes)) bytes[Number(offset)] = value;
  return bytes;
}

function expectError(result: { ok: boolean; error?: string }, error: string) {
  expect(result).toEqual({ ok: false, error });
}

describe("layout", () => {
  test("is 62 + 64 + 4 + 64 = 194 bytes", () => {
    expect(CERTIFICATE_BODY_LENGTH).toBe(62);
    expect(CERTIFICATE_LENGTH).toBe(126);
    expect(QR_PAYLOAD_LENGTH).toBe(194);
    expect(encodeQrPayload(PAYLOAD)).toHaveLength(194);
  });

  test("puts every field at its offset, big-endian", () => {
    const bytes = encodeQrPayload(PAYLOAD);
    expect(bytes[0]).toBe(1);
    expect(bytes[1]).toBe(7);
    expect(Array.from(bytes.subarray(2, 18))).toEqual([
      0x01, 0x92, 0xf0, 0xc4, 0x1b, 0x2a, 0x4c, 0x3d, 0x8e, 0x4f, 0x5a, 0x6b, 0x7c, 0x8d, 0x9e,
      0x0f,
    ]);
    expect(Array.from(bytes.subarray(18, 26))).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(Array.from(bytes.subarray(26, 28))).toEqual([0x01, 0x02]);
    expect(bytes[28]).toBe(0b1101); // multi-scan, 18+, named
    expect(bytes.subarray(29, 61).every((b) => b === 0xaa)).toBe(true);
    expect(bytes[61]).toBe(3);
    expect(bytes.subarray(62, 126).every((b) => b === 0xbb)).toBe(true);
    expect(Array.from(bytes.subarray(126, 130))).toEqual([1, 2, 3, 4]);
    expect(bytes.subarray(130, 194).every((b) => b === 0xcc)).toBe(true);
  });

  test("encodes each flag on its own bit", () => {
    const flags = (fields: Partial<CertificateFields>) =>
      encodeCertificateBody({ ...FIELDS, ...fields })[28];
    expect(flags({ entryMode: "single_use", ageRating: "all", named: false })).toBe(0b0000);
    expect(flags({ entryMode: "multi_scan", ageRating: "all", named: false })).toBe(0b0001);
    expect(flags({ entryMode: "single_use", ageRating: "12plus", named: false })).toBe(0b0010);
    expect(flags({ entryMode: "single_use", ageRating: "18plus", named: false })).toBe(0b0100);
    expect(flags({ entryMode: "single_use", ageRating: "all", named: true })).toBe(0b1000);
  });

  test("the body is the first 62 bytes of the certificate and of the payload", () => {
    fc.assert(
      fc.property(payloadArb, (payload) => {
        const body = encodeCertificateBody(payload.certificate.fields);
        expect(encodeCertificate(payload.certificate).subarray(0, 62)).toEqual(body);
        expect(encodeQrPayload(payload).subarray(0, 62)).toEqual(body);
      }),
    );
  });

  test("fits a version 10-M QR code in alphanumeric mode (311 characters)", () => {
    expect(encodeQr(PAYLOAD)).toHaveLength(291);
  });

  test("encodes a time window as 4 big-endian bytes", () => {
    expect(Array.from(encodeTimeWindow(0xfffffffe))).toEqual([0xff, 0xff, 0xff, 0xfe]);
  });
});

describe("round trip", () => {
  test("a certificate", () => {
    fc.assert(
      fc.property(certificateArb, (certificate) => {
        expect(decodeCertificate(encodeCertificate(certificate))).toEqual({
          ok: true,
          value: certificate,
        });
      }),
    );
  });

  test("a payload, as bytes and as QR text", () => {
    fc.assert(
      fc.property(payloadArb, (payload) => {
        const expected = { ok: true, value: payload };
        expect(decodeQrPayload(encodeQrPayload(payload))).toEqual(expected);
        expect(decodeQr(encodeQr(payload))).toEqual(expected);
      }),
    );
  });

  test("whatever decodes re-encodes to the same bytes", () => {
    const frameArb = bytesArb(QR_PAYLOAD_LENGTH).map((bytes) => {
      bytes[0] = 1;
      return bytes;
    });
    fc.assert(
      fc.property(frameArb, (bytes) => {
        const decoded = decodeQrPayload(bytes);
        if (decoded.ok) expect(encodeQrPayload(decoded.value)).toEqual(bytes);
        else
          expect(["reserved_flags", "invalid_age_rating", "invalid_key_version"]).toContain(
            decoded.error,
          );
      }),
    );
  });

  test("decoded byte fields are copies of the input", () => {
    const bytes = encodeQrPayload(PAYLOAD);
    const decoded = decodeQrPayload(bytes);
    bytes.fill(0);
    expect(decoded).toEqual({ ok: true, value: PAYLOAD });
  });

  test("decodes a payload that is a view into a larger buffer", () => {
    const buffer = new Uint8Array(QR_PAYLOAD_LENGTH + 10);
    buffer.set(encodeQrPayload(PAYLOAD), 5);
    expect(decodeQrPayload(buffer.subarray(5, 5 + QR_PAYLOAD_LENGTH))).toEqual({
      ok: true,
      value: PAYLOAD,
    });
  });
});

describe("decoding rejects", () => {
  test("unknown versions, before any length check", () => {
    for (const version of [0, 2, 255]) {
      expectError(decodeQrPayload(payloadWith({ 0: version })), "unknown_version");
      expectError(decodeQrPayload(Uint8Array.of(version)), "unknown_version");
      expectError(decodeCertificate(Uint8Array.of(version)), "unknown_version");
    }
  });

  test("empty and short input", () => {
    const bytes = encodeQrPayload(PAYLOAD);
    expectError(decodeQrPayload(new Uint8Array()), "too_short");
    expectError(decodeQrPayload(bytes.subarray(0, 193)), "too_short");
    expectError(decodeQrPayload(bytes.subarray(0, 126)), "too_short");
    expectError(decodeCertificate(bytes.subarray(0, 125)), "too_short");
  });

  test("trailing bytes", () => {
    const bytes = encodeQrPayload(PAYLOAD);
    expectError(decodeQrPayload(Uint8Array.from([...bytes, 0])), "trailing_bytes");
    expectError(decodeCertificate(bytes), "trailing_bytes");
  });

  test("any truncation or extension of a valid payload", () => {
    fc.assert(
      fc.property(payloadArb, fc.integer({ min: 1, max: 193 }), (payload, length) => {
        const bytes = encodeQrPayload(payload);
        expectError(decodeQrPayload(bytes.subarray(0, length)), "too_short");
        const longer = new Uint8Array(QR_PAYLOAD_LENGTH + length);
        longer.set(bytes);
        expectError(decodeQrPayload(longer), "trailing_bytes");
      }),
    );
  });

  test("reserved flag bits", () => {
    for (const bit of [0x10, 0x20, 0x40, 0x80]) {
      expectError(decodeQrPayload(payloadWith({ 28: 0b0001 | bit })), "reserved_flags");
    }
  });

  test("the fourth age rating value", () => {
    expectError(decodeQrPayload(payloadWith({ 28: 0b0110 })), "invalid_age_rating");
    expectError(
      decodeCertificate(payloadWith({ 28: 0b0110 }).subarray(0, 126)),
      "invalid_age_rating",
    );
  });

  test("key version 0: an unbound ticket has no certificate", () => {
    expectError(decodeQrPayload(payloadWith({ 61: 0 })), "invalid_key_version");
  });

  test("text that is not Base45", () => {
    expectError(decodeQr("not base45"), "invalid_base45");
  });

  test("Base45 text of the wrong bytes", () => {
    expectError(decodeQr(encodeBase45(encodeQrPayload(PAYLOAD).subarray(0, 100))), "too_short");
  });
});

describe("encoding rejects values outside the format", () => {
  const body = (fields: Partial<Record<keyof CertificateFields, unknown>>) => () =>
    encodeCertificateBody({ ...FIELDS, ...fields } as CertificateFields);

  test.each([
    ["serverKeyId", -1],
    ["serverKeyId", 256],
    ["serverKeyId", 1.5],
    ["typeRef", 0x10000],
    ["keyVersion", 0],
    ["keyVersion", 256],
  ])("%s = %d", (name, value) => {
    expect(body({ [name]: value })).toThrow(RangeError);
  });

  test.each([
    ["eventRef", new Uint8Array(7)],
    ["eventRef", new Uint8Array(9)],
    ["holderPubkey", new Uint8Array(31)],
    ["holderPubkey", new Uint8Array(33)],
  ])("%s of the wrong length", (name, value) => {
    expect(body({ [name]: value })).toThrow(RangeError);
  });

  test("a ticket id that is not a lowercase UUID", () => {
    expect(body({ ticketId: "0192F0C4-1B2A-4C3D-8E4F-5A6B7C8D9E0F" })).toThrow(RangeError);
    expect(body({ ticketId: "not-a-uuid" })).toThrow(RangeError);
  });

  test("unknown entry modes and age ratings", () => {
    expect(body({ entryMode: "twice" })).toThrow(RangeError);
    expect(body({ ageRating: "21plus" })).toThrow(RangeError);
  });

  test("signatures of the wrong length", () => {
    const short = new Uint8Array(63);
    expect(() => encodeCertificate({ fields: FIELDS, serverSig: short })).toThrow(RangeError);
    expect(() => encodeQrPayload({ ...PAYLOAD, holderSig: short })).toThrow(RangeError);
  });

  test("success paths", () => {
    expect(encodeCertificate(PAYLOAD.certificate)).toBeInstanceOf(Uint8Array);
    expect(encodeTimeWindow(PAYLOAD.timeWindow)).toBeInstanceOf(Uint8Array);
    expect(encodeQrPayload(PAYLOAD)).toBeInstanceOf(Uint8Array);
    expect(typeof encodeQr(PAYLOAD)).toBe("string");
  });

  test("time windows outside 32 bits", () => {
    for (const timeWindow of [-1, 2 ** 32, 0.5]) {
      expect(() => encodeTimeWindow(timeWindow)).toThrow(RangeError);
      expect(() => encodeQrPayload({ ...PAYLOAD, timeWindow })).toThrow(RangeError);
    }
  });
});
