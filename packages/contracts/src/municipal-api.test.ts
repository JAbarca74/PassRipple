import { describe, expect, it } from "vitest";
import {
  decideAuthorizationRequest,
  grantInspectorRequest,
  requestAuthorizationRequest,
  verifyTicketRequest,
} from "./municipal-api.ts";

const eventId = "12345678-1234-4234-8234-123456789001";

describe("requestAuthorizationRequest", () => {
  it("takes a portal request with only the event", () => {
    expect(requestAuthorizationRequest.safeParse({ mode: "portal", eventId }).success).toBe(true);
  });

  it("requires the reference of the document variant", () => {
    expect(requestAuthorizationRequest.safeParse({ mode: "document", eventId }).success).toBe(
      false,
    );
    expect(
      requestAuthorizationRequest.safeParse({ mode: "document", eventId, reference: " SELLO-1 " }),
    ).toMatchObject({ success: true, data: { reference: "SELLO-1" } });
  });

  it("rejects an unknown mode", () => {
    expect(requestAuthorizationRequest.safeParse({ mode: "other", eventId }).success).toBe(false);
  });
});

describe("decideAuthorizationRequest", () => {
  it("needs a boolean decision and trims the notes", () => {
    expect(decideAuthorizationRequest.safeParse({}).success).toBe(false);
    expect(decideAuthorizationRequest.safeParse({ approve: "yes" }).success).toBe(false);
    expect(
      decideAuthorizationRequest.safeParse({ approve: false, notes: "  falta el permiso  " }),
    ).toMatchObject({ success: true, data: { notes: "falta el permiso" } });
  });
});

describe("grantInspectorRequest", () => {
  it("accepts an email, a canton code and a kind", () => {
    expect(
      grantInspectorRequest.safeParse({
        email: "a@b.cr",
        cantonCode: "PEREZ-ZELEDON",
        kind: "official",
      }).success,
    ).toBe(true);
  });

  it("rejects a bad email, canton code or kind", () => {
    const ok = { email: "a@b.cr", cantonCode: "X1", kind: "inspector" };
    expect(grantInspectorRequest.safeParse({ ...ok, email: "no" }).success).toBe(false);
    expect(grantInspectorRequest.safeParse({ ...ok, cantonCode: "x y" }).success).toBe(false);
    expect(grantInspectorRequest.safeParse({ ...ok, kind: "boss" }).success).toBe(false);
  });
});

describe("verifyTicketRequest", () => {
  it("accepts a typed code and rejects an empty one", () => {
    expect(verifyTicketRequest.safeParse({ code: " abcd-efgh " }).success).toBe(true);
    expect(verifyTicketRequest.safeParse({ code: "" }).success).toBe(false);
  });
});
