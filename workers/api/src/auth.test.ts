import type { Context } from "hono";
import { describe, expect, test, vi } from "vitest";
import {
  type AuthenticatedDevice,
  bearer,
  deviceActor,
  gateDeviceView,
  userActor,
} from "./auth.ts";
import { DEVICE_TOKEN_PREFIX, tokenHash, USER_TOKEN_PREFIX } from "./secrets.ts";

function mockContext(authHeader?: string, orgHeader?: string): Context {
  return {
    req: {
      header: (name: string) => {
        if (name === "authorization") return authHeader;
        if (name === "x-org-id") return orgHeader;
        return undefined;
      },
    },
  } as unknown as Context;
}

describe("bearer", () => {
  test("returns token if prefix matches", () => {
    const ctx = mockContext(`Bearer ${USER_TOKEN_PREFIX}123`);
    expect(bearer(ctx, USER_TOKEN_PREFIX)).toBe(`${USER_TOKEN_PREFIX}123`);
  });

  test("throws 401 if missing authorization", () => {
    const ctx = mockContext(undefined);
    expect(() => bearer(ctx, USER_TOKEN_PREFIX)).toThrow(/Sign in again/);
  });

  test("throws 401 if wrong prefix", () => {
    const ctx = mockContext(`Bearer wrong_prefix_123`);
    expect(() => bearer(ctx, USER_TOKEN_PREFIX)).toThrow(/Sign in again/);
  });

  test("throws 401 if token is too long", () => {
    const long = USER_TOKEN_PREFIX + "a".repeat(150);
    const ctx = mockContext(`Bearer ${long}`);
    expect(() => bearer(ctx, USER_TOKEN_PREFIX)).toThrow(/Sign in again/);
  });
});

describe("userActor", () => {
  test("returns an actor resolver that calls authenticate_session", async () => {
    const ctx = mockContext(
      `Bearer ${USER_TOKEN_PREFIX}123`,
      "00000000-0000-0000-0000-000000000001",
    );
    const resolver = await userActor(ctx, "organizer");

    const tx = vi.fn().mockResolvedValue([{ user_id: "00000000-0000-0000-0000-000000000002" }]);
    const actor = await resolver(tx as any);

    expect(actor).toEqual({
      id: "00000000-0000-0000-0000-000000000002",
      role: "organizer",
      orgId: "00000000-0000-0000-0000-000000000001",
    });

    const hash = await tokenHash(`${USER_TOKEN_PREFIX}123`);
    const call0 = tx.mock.calls[0];
    if (!call0) throw new Error("mock call missing");
    expect(call0[1]).toEqual(hash); // First argument is query parts, second is substitution
  });

  test("throws 401 if session is not found", async () => {
    const ctx = mockContext(`Bearer ${USER_TOKEN_PREFIX}123`);
    const resolver = await userActor(ctx, "staff");

    const tx = vi.fn().mockResolvedValue([]);
    await expect(resolver(tx as any)).rejects.toThrow(/Sign in again/);
  });

  test("throws 400 if x-org-id is invalid for organizer", async () => {
    const ctx = mockContext(`Bearer ${USER_TOKEN_PREFIX}123`, "invalid");
    await expect(userActor(ctx, "organizer")).rejects.toThrow(/x-org-id/i);
  });
});

describe("deviceActor", () => {
  const row = {
    device_id: "dev1",
    user_id: "usr1",
    event_id: "evt1",
    role: "gate",
    zone: "Zone A",
    valid_from: new Date("2024-01-01T00:00:00Z"),
    valid_until: new Date("2024-01-02T00:00:00Z"),
    revoked_at: null,
    status: "active",
  };

  test("resolves actor and calls found callback if status is allowed", async () => {
    const ctx = mockContext(`Bearer ${DEVICE_TOKEN_PREFIX}123`);
    const found = vi.fn();
    const resolver = await deviceActor(ctx, ["active"], found);

    const tx = vi.fn().mockResolvedValue([row]);
    const actor = await resolver(tx as any);

    expect(actor).toEqual({ id: "usr1", role: "staff", orgId: null });
    expect(found).toHaveBeenCalledWith({
      deviceId: "dev1",
      userId: "usr1",
      eventId: "evt1",
      role: "gate",
      zone: "Zone A",
      validFrom: "2024-01-01T00:00:00.000Z",
      validUntil: "2024-01-02T00:00:00.000Z",
      revokedAt: null,
      status: "active",
    });
  });

  test("throws 403 if status is not allowed", async () => {
    const ctx = mockContext(`Bearer ${DEVICE_TOKEN_PREFIX}123`);
    const resolver = await deviceActor(ctx, ["revoked"], vi.fn());

    const tx = vi.fn().mockResolvedValue([row]);
    await expect(resolver(tx as any)).rejects.toThrow(/This device is/);
  });

  test("throws 401 if device not found", async () => {
    const ctx = mockContext(`Bearer ${DEVICE_TOKEN_PREFIX}123`);
    const resolver = await deviceActor(ctx, ["active"], vi.fn());

    const tx = vi.fn().mockResolvedValue([]);
    await expect(resolver(tx as any)).rejects.toThrow(/Sign in again/);
  });
});

describe("gateDeviceView", () => {
  test("picks only gate fields", () => {
    const dev: AuthenticatedDevice = {
      deviceId: "dev1",
      userId: "usr1", // should be omitted
      eventId: "evt1",
      role: "gate",
      zone: "Zone A",
      validFrom: "2024-01-01T00:00:00.000Z",
      validUntil: "2024-01-02T00:00:00.000Z",
      revokedAt: null, // should be omitted
      status: "active",
    };

    const view = gateDeviceView(dev);
    expect(view).toEqual({
      deviceId: "dev1",
      eventId: "evt1",
      role: "gate",
      zone: "Zone A",
      validFrom: "2024-01-01T00:00:00.000Z",
      validUntil: "2024-01-02T00:00:00.000Z",
      status: "active",
    });
  });
});
