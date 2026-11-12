import { describe, expect, it, vi } from "vitest";
import {
  type CoordinatorAnswer,
  claimWithCoordinator,
  withCoordinatorAnswer,
} from "./coordinator.ts";
import type { GateDecision } from "./verify.ts";

const config = { url: "http://192.168.1.10:8800", token: "zone-token-0123456789" };
const TICKET = "12345678-1234-4234-8234-123456789001";
const DEVICE = "12345678-1234-4234-8234-12345678000a";

function reply(body: unknown, status = 200): typeof fetch {
  return vi.fn(
    async () => new Response(JSON.stringify(body), { status }),
  ) as unknown as typeof fetch;
}

describe("claimWithCoordinator", () => {
  it("sends the claim with the zone token", async () => {
    const fetchFn = reply({ status: "granted", deviceId: DEVICE, claimedAt: 1 });
    expect(await claimWithCoordinator(config, TICKET, DEVICE, fetchFn)).toEqual({
      kind: "granted",
    });
    const [url, init] = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe("http://192.168.1.10:8800/v1/claim");
    expect((init.headers as Record<string, string>)["x-coordinator-token"]).toBe(config.token);
    expect(JSON.parse(init.body as string)).toEqual({ ticketId: TICKET, deviceId: DEVICE });
  });

  it("reports who already holds the ticket", async () => {
    const fetchFn = reply({ status: "already", deviceId: "other", claimedAt: 99 });
    expect(await claimWithCoordinator(config, TICKET, DEVICE, fetchFn)).toEqual({
      kind: "already",
      deviceId: "other",
      claimedAt: 99,
    });
  });

  it("is unreachable on a refusal, a strange answer, a network error or a timeout", async () => {
    expect(await claimWithCoordinator(config, TICKET, DEVICE, reply({}, 401))).toEqual({
      kind: "unreachable",
    });
    expect(await claimWithCoordinator(config, TICKET, DEVICE, reply({ status: "x" }))).toEqual({
      kind: "unreachable",
    });
    expect(
      await claimWithCoordinator(config, TICKET, DEVICE, reply({ status: "already" })),
    ).toEqual({
      kind: "unreachable",
    });
    const broken = vi.fn(async () => {
      throw new TypeError("network");
    }) as unknown as typeof fetch;
    expect(await claimWithCoordinator(config, TICKET, DEVICE, broken)).toEqual({
      kind: "unreachable",
    });
    const hanging = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    ) as unknown as typeof fetch;
    expect(await claimWithCoordinator(config, TICKET, DEVICE, hanging, 10)).toEqual({
      kind: "unreachable",
    });
  });
});

describe("withCoordinatorAnswer", () => {
  const admit = (entryMode: "single_use" | "multi_scan"): GateDecision => ({
    kind: "admit",
    ticketId: TICKET,
    typeRef: 1,
    keyVersion: 0,
    entryMode,
    typeName: "General",
    inManifest: true,
    holderPubkey: null,
  });
  const already: CoordinatorAnswer = { kind: "already", deviceId: "other", claimedAt: 1 };

  it("turns a single-use admission into a rejection when another gate has the ticket", () => {
    expect(withCoordinatorAnswer(admit("single_use"), already)).toEqual({
      kind: "reject",
      reason: "already_redeemed",
      ticketId: TICKET,
      typeName: "General",
    });
  });

  it("leaves the gate's decision alone otherwise", () => {
    const own = admit("single_use");
    expect(withCoordinatorAnswer(own, { kind: "granted" })).toBe(own);
    expect(withCoordinatorAnswer(own, { kind: "unreachable" })).toBe(own);
    const multi = admit("multi_scan");
    expect(withCoordinatorAnswer(multi, already)).toBe(multi);
    const rejected: GateDecision = {
      kind: "reject",
      reason: "void",
      ticketId: TICKET,
      typeName: null,
    };
    expect(withCoordinatorAnswer(rejected, already)).toBe(rejected);
  });
});
