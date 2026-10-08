import { describe, expect, test, vi } from "vitest";
import { checkManifest, decideQr, type GateLookups } from "./verify.ts";
import type { StoredTicket } from "./manifest-store.ts";
import { verifyCredential } from "@passripple/crypto";

vi.mock("@passripple/crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@passripple/crypto")>();
  return {
    ...actual,
    verifyCredential: vi.fn(),
  };
});

describe("checkManifest", () => {
  const baseTicket: StoredTicket = {
    ticketId: "t1",
    typeRef: 1,
    entryMode: "single_use",
    status: "issued",
    redeemed: false,
    keyVersion: 2,
    holderPubkey: new Uint8Array([1]),
    codeHuman: "ABC",
  };

  test("rejects void tickets", () => {
    const t = { ...baseTicket, status: "void" as const };
    expect(checkManifest(t, "Type 1", null)).toEqual({
      kind: "reject",
      reason: "void",
      ticketId: "t1",
      typeName: "Type 1",
    });
  });

  test("rejects stale key version", () => {
    const cred = { keyVersion: 1, holderPubkey: new Uint8Array([2]) };
    expect(checkManifest(baseTicket, "Type 1", cred)).toEqual({
      kind: "reject",
      reason: "stale_key",
      ticketId: "t1",
      typeName: "Type 1",
    });
  });

  test("rejects already redeemed single use tickets", () => {
    const t = { ...baseTicket, redeemed: true };
    expect(checkManifest(t, "Type 1", null)).toEqual({
      kind: "reject",
      reason: "already_redeemed",
      ticketId: "t1",
      typeName: "Type 1",
    });
  });

  test("admits valid single use tickets", () => {
    expect(checkManifest(baseTicket, "Type 1", null)).toEqual({
      kind: "admit",
      ticketId: "t1",
      typeName: "Type 1",
      typeRef: 1,
      keyVersion: 2,
      entryMode: "single_use",
      inManifest: true,
      holderPubkey: baseTicket.holderPubkey,
    });
  });

  test("uses credential properties if provided", () => {
    const cred = { keyVersion: 3, holderPubkey: new Uint8Array([3]) };
    expect(checkManifest(baseTicket, "Type 1", cred)).toEqual({
      kind: "admit",
      ticketId: "t1",
      typeName: "Type 1",
      typeRef: 1,
      keyVersion: 3,
      entryMode: "single_use",
      inManifest: true,
      holderPubkey: cred.holderPubkey,
    });
  });

  test("admits redeemed multi scan tickets", () => {
    const t = { ...baseTicket, entryMode: "multi_scan" as const, redeemed: true };
    expect(checkManifest(t, "Type 1", null).kind).toBe("admit");
  });
});

describe("decideQr", () => {
  const lookups: GateLookups = {
    serverKeys: [{ id: 1, publicKey: new Uint8Array() }],
    eventId: "e1",
    ticketTypes: new Map([[1, { name: "Type 1", entryMode: "single_use" }]]),
    ticket: vi.fn(),
  };

  test("rejects if verifyCredential fails", async () => {
    vi.mocked(verifyCredential).mockReturnValue({ ok: false, reason: "bad_server_signature" });
    const dec = await decideQr("qr", lookups, 0);
    expect(dec).toEqual({ kind: "reject", reason: "bad_server_signature", ticketId: null, typeName: null });
  });

  test("rejects wrong zone if type not in lookups", async () => {
    vi.mocked(verifyCredential).mockReturnValue({
      ok: true,
      credential: { ticketId: "t1", typeRef: 99, keyVersion: 1, entryMode: "single_use", holderPubkey: new Uint8Array() }
    });
    const dec = await decideQr("qr", lookups, 0);
    expect(dec).toEqual({ kind: "reject", reason: "wrong_zone", ticketId: "t1", typeName: null });
  });

  test("admits not in manifest if ticket is missing", async () => {
    vi.mocked(verifyCredential).mockReturnValue({
      ok: true,
      credential: { ticketId: "t1", typeRef: 1, keyVersion: 2, entryMode: "single_use", holderPubkey: new Uint8Array() }
    });
    vi.mocked(lookups.ticket).mockResolvedValue(null);
    const dec = await decideQr("qr", lookups, 0);
    expect(dec).toEqual({
      kind: "admit",
      ticketId: "t1",
      typeRef: 1,
      keyVersion: 2,
      entryMode: "single_use",
      typeName: "Type 1",
      inManifest: false,
      holderPubkey: expect.any(Uint8Array),
    });
  });

  test("delegates to checkManifest if ticket is found", async () => {
    vi.mocked(verifyCredential).mockReturnValue({
      ok: true,
      credential: { ticketId: "t1", typeRef: 1, keyVersion: 2, entryMode: "single_use", holderPubkey: new Uint8Array() }
    });
    const ticket: StoredTicket = { ticketId: "t1", typeRef: 1, status: "void", entryMode: "single_use", redeemed: false, keyVersion: 1, holderPubkey: new Uint8Array(), codeHuman: "123" };
    vi.mocked(lookups.ticket).mockResolvedValue(ticket);
    const dec = await decideQr("qr", lookups, 0);
    
    // should be rejected as void by checkManifest
    expect(dec).toEqual({
      kind: "reject",
      reason: "void",
      ticketId: "t1",
      typeName: "Type 1",
    });
  });
});
