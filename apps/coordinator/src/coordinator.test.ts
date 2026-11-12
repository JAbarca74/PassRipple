import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { createCoordinatorApp } from "./app.ts";
import { MemoryClaimStore, SqliteClaimStore } from "./claims.ts";

const TICKET = "12345678-1234-4234-8234-123456789001";
const DEVICE_A = "12345678-1234-4234-8234-12345678000a";
const DEVICE_B = "12345678-1234-4234-8234-12345678000b";
const TOKEN = "zone-token-0123456789";

describe.each([
  ["memory", () => new MemoryClaimStore()],
  ["sqlite", () => new SqliteClaimStore(new DatabaseSync(":memory:"))],
])("%s claim store", (_name, make) => {
  it("gives the ticket to the first device and tells the second who has it", () => {
    const store = make();
    expect(store.claim(TICKET, DEVICE_A, 1000)).toEqual({
      status: "granted",
      deviceId: DEVICE_A,
      claimedAt: 1000,
    });
    expect(store.claim(TICKET, DEVICE_B, 2000)).toEqual({
      status: "already",
      deviceId: DEVICE_A,
      claimedAt: 1000,
    });
    expect(store.count()).toBe(1);
  });

  it("answers the same when the first device asks again", () => {
    const store = make();
    store.claim(TICKET, DEVICE_A, 1000);
    expect(store.claim(TICKET, DEVICE_A, 5000)).toEqual({
      status: "granted",
      deviceId: DEVICE_A,
      claimedAt: 1000,
    });
  });
});

describe("coordinator app", () => {
  const app = () => createCoordinatorApp(new MemoryClaimStore(), TOKEN, () => 42);
  const post = (instance: ReturnType<typeof app>, body: unknown, token: string | null = TOKEN) =>
    instance.request("/v1/claim", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { "x-coordinator-token": token } : {}),
      },
      body: JSON.stringify(body),
    });

  it("refuses a short token at startup", () => {
    expect(() => createCoordinatorApp(new MemoryClaimStore(), "short")).toThrow();
  });

  it("answers health without a token", async () => {
    const res = await app().request("/health");
    expect(await res.json()).toEqual({ ok: true, claims: 0 });
  });

  it("needs the zone token to claim", async () => {
    const instance = app();
    const claim = { ticketId: TICKET, deviceId: DEVICE_A };
    expect((await post(instance, claim, null)).status).toBe(401);
    expect((await post(instance, claim, "wrong-token-0123456789")).status).toBe(401);
    expect((await post(instance, claim, "x")).status).toBe(401);
  });

  it("grants the first claim and refuses the second device", async () => {
    const instance = app();
    const first = await post(instance, { ticketId: TICKET, deviceId: DEVICE_A });
    expect(await first.json()).toEqual({ status: "granted", deviceId: DEVICE_A, claimedAt: 42 });
    const second = await post(instance, { ticketId: TICKET, deviceId: DEVICE_B });
    expect(await second.json()).toMatchObject({ status: "already", deviceId: DEVICE_A });
  });

  it("rejects a malformed claim", async () => {
    const instance = app();
    expect((await post(instance, { ticketId: "no", deviceId: DEVICE_A })).status).toBe(400);
    const notJson = await instance.request("/v1/claim", {
      method: "POST",
      headers: { "x-coordinator-token": TOKEN },
      body: "{",
    });
    expect(notJson.status).toBe(400);
  });
});
