import { describe, expect, test } from "vitest";
import {
  apiError,
  assignBlockRequest,
  assignedBlock,
  closedBlock,
  createStaffCodeRequest,
  enrollRequest,
  enrollResponse,
  gateDevice,
  gateSessionResponse,
  sessionProfile,
  signInRequest,
  verifySignInRequest,
} from "./staff-api.ts";

describe("staff-api", () => {
  describe("signInRequest", () => {
    test("trims and lowercases the email", () => {
      expect(signInRequest.parse({ email: "  TEST@Example.com  " }).email).toBe("test@example.com");
    });

    test("rejects missing @ or more than 254 characters", () => {
      expect(() => signInRequest.parse({ email: "notanemail" })).toThrow();
      expect(() => signInRequest.parse({ email: `${"a".repeat(250)}@example.com` })).toThrow();
    });
  });

  describe("verifySignInRequest", () => {
    test("accepts only 6 digits", () => {
      const valid = { email: "test@example.com", code: "123456" };
      expect(verifySignInRequest.parse(valid)).toEqual(valid);

      expect(() =>
        verifySignInRequest.parse({ email: "test@example.com", code: "12345" }),
      ).toThrow();
      expect(() =>
        verifySignInRequest.parse({ email: "test@example.com", code: "1234567" }),
      ).toThrow();
      expect(() =>
        verifySignInRequest.parse({ email: "test@example.com", code: "123a56" }),
      ).toThrow();
    });
  });

  describe("createStaffCodeRequest", () => {
    test("defaults zone to null", () => {
      const valid = {
        eventId: "12345678-1234-4234-8234-123456789012",
        role: "gate" as const,
        validFrom: "2024-01-01T12:00:00Z",
        validUntil: "2024-01-02T12:00:00Z",
        maxUses: 10,
      };
      expect(createStaffCodeRequest.parse(valid).zone).toBeNull();
    });

    test("rejects invalid inputs", () => {
      const base = {
        eventId: "12345678-1234-4234-8234-123456789012",
        role: "gate" as const,
        validFrom: "2024-01-01T12:00:00Z",
        validUntil: "2024-01-02T12:00:00Z",
        maxUses: 10,
      };

      // validUntil <= validFrom
      expect(() =>
        createStaffCodeRequest.parse({ ...base, validUntil: "2024-01-01T12:00:00Z" }),
      ).toThrow();
      expect(() =>
        createStaffCodeRequest.parse({ ...base, validUntil: "2024-01-01T11:00:00Z" }),
      ).toThrow();

      // maxUses 0 and 1001
      expect(() => createStaffCodeRequest.parse({ ...base, maxUses: 0 })).toThrow();
      expect(() => createStaffCodeRequest.parse({ ...base, maxUses: 1001 })).toThrow();

      // unknown role
      expect(() => createStaffCodeRequest.parse({ ...base, role: "admin" })).toThrow();

      // dates without timezone
      expect(() =>
        createStaffCodeRequest.parse({ ...base, validFrom: "2024-01-01T12:00:00" }),
      ).toThrow();
    });
  });

  describe("enrollRequest", () => {
    test("defaults integrityToken to null and only accepts android and ios", () => {
      const validAndroid = {
        staffCode: "CODE123",
        platform: "android" as const,
        appVersion: "1.0.0",
      };
      expect(enrollRequest.parse(validAndroid).integrityToken).toBeNull();

      const validIos = { staffCode: "CODE123", platform: "ios" as const, appVersion: "1.0.0" };
      expect(enrollRequest.parse(validIos).integrityToken).toBeNull();

      // other platforms
      expect(() => enrollRequest.parse({ ...validAndroid, platform: "web" })).toThrow();
    });
  });

  describe("responses and types", () => {
    const validDevice = {
      deviceId: "12345678-1234-4234-8234-123456789012",
      eventId: "12345678-1234-4234-8234-123456789013",
      role: "gate" as const,
      zone: null,
      validFrom: "2024-01-01T12:00:00Z",
      validUntil: "2024-01-02T12:00:00Z",
      status: "active" as const,
    };

    test("gateDevice", () => {
      expect(gateDevice.parse(validDevice)).toEqual(validDevice);
      expect(() => gateDevice.parse({ ...validDevice, status: "unknown" })).toThrow();
    });

    test("enrollResponse", () => {
      const valid = { deviceToken: "token123", device: validDevice };
      expect(enrollResponse.parse(valid)).toEqual(valid);
      expect(() => enrollResponse.parse({ device: validDevice })).toThrow();
    });

    test("gateSessionResponse", () => {
      const valid = { device: validDevice, serverTime: 1700000000000 };
      expect(gateSessionResponse.parse(valid)).toEqual(valid);
      expect(() => gateSessionResponse.parse({ device: validDevice, serverTime: -1 })).toThrow();
    });

    test("apiError", () => {
      const valid = { error: { code: "not_found", message: "Not found" } };
      expect(apiError.parse(valid)).toEqual(valid);
      expect(() => apiError.parse({ error: { code: "not_found" } })).toThrow();
    });
  });
});

describe("sessionProfile", () => {
  test("lists the organizations a person acts for", () => {
    const profile = {
      userId: "12345678-1234-4234-8234-123456789001",
      isAdmin: false,
      organizations: [{ id: "12345678-1234-4234-8234-123456789002", name: "Org A" }],
      municipal: [{ canton: "PZ", kind: "official" as const }],
    };
    expect(sessionProfile.parse(profile)).toEqual(profile);
    expect(
      sessionProfile.safeParse({ ...profile, organizations: [{ id: "x", name: "A" }] }).success,
    ).toBe(false);
  });
});

describe("door-sales blocks", () => {
  const typeId = "12345678-1234-4234-8234-123456789010";

  test("a block has 1 to 1000 seats of one ticket type", () => {
    expect(assignBlockRequest.parse({ ticketTypeId: typeId, size: 50 })).toEqual({
      ticketTypeId: typeId,
      size: 50,
    });
    for (const size of [0, 1001, 2.5]) {
      expect(assignBlockRequest.safeParse({ ticketTypeId: typeId, size }).success).toBe(false);
    }
    expect(assignBlockRequest.safeParse({ ticketTypeId: "x", size: 5 }).success).toBe(false);
  });

  test("the answers carry the block and what went back", () => {
    const block = { blockId: typeId, deviceId: typeId, ticketTypeId: typeId, size: 5 };
    expect(assignedBlock.parse(block)).toEqual(block);
    expect(closedBlock.parse({ blockId: typeId, returned: 0 })).toEqual({
      blockId: typeId,
      returned: 0,
    });
    expect(closedBlock.safeParse({ blockId: typeId, returned: -1 }).success).toBe(false);
  });
});
