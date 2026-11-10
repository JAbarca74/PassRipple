import { describe, expect, test } from "vitest";
import { eventDashboard } from "./reporting-api.ts";

const AT = "2026-11-10T12:00:00-06:00";

const dashboard = {
  eventId: "12345678-1234-4234-8234-123456789001",
  counters: {
    permittedCapacity: 50,
    committed: 6,
    sold: 2,
    courtesies: 1,
    doorSales: 1,
    admitted: 2,
    duplicates: 1,
    incidents: 1,
    salesByHour: [{ hour: "2026-11-10T15:00:00", tickets: 2 }],
  },
  devices: [
    {
      deviceId: "12345678-1234-4234-8234-123456789002",
      role: "gate",
      zone: null,
      enrolledAt: AT,
      validUntil: AT,
      revokedAt: null,
      lastSyncAt: null,
      admitted: 0,
      incidents: 0,
    },
  ],
};

describe("reporting-api", () => {
  test("accepts a dashboard, including a device that never synced", () => {
    expect(eventDashboard.parse(dashboard)).toEqual(dashboard);
  });

  test("rejects negative counts, a zero capacity and an unknown role", () => {
    const bad = (counters: object) =>
      eventDashboard.safeParse({ ...dashboard, counters: { ...dashboard.counters, ...counters } })
        .success;
    expect(bad({ sold: -1 })).toBe(false);
    expect(bad({ permittedCapacity: 0 })).toBe(false);
    expect(
      eventDashboard.safeParse({
        ...dashboard,
        devices: [{ ...dashboard.devices[0], role: "cashier" }],
      }).success,
    ).toBe(false);
  });
});
