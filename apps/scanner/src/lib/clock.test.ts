import { describe, expect, test, vi } from "vitest";
import { DeviceClock } from "./clock.ts";

describe("DeviceClock", () => {
  test("starts unsynced with optional stored snapshot", () => {
    const clock = new DeviceClock();
    expect(clock.isSynced()).toBe(false);
    expect(clock.snapshot()).toBeNull();

    const stored = { offsetMs: 5000, rttMs: 100, sampledAt: 123 };
    const clock2 = new DeviceClock(stored);
    expect(clock2.isSynced()).toBe(false);
    expect(clock2.snapshot()).toEqual(stored);
  });

  test("restore updates stored snapshot", () => {
    const clock = new DeviceClock();
    const stored = { offsetMs: 5000, rttMs: 100, sampledAt: 123 };
    clock.restore(stored);
    expect(clock.snapshot()).toEqual(stored);
  });

  test("now without anchor uses Date.now() + offsetMs", () => {
    const realNow = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(realNow);

    const clock = new DeviceClock({ offsetMs: 5000, rttMs: 100, sampledAt: 123 });
    expect(clock.now()).toBe(realNow + 5000);

    vi.restoreAllMocks();
  });

  test("sample ignores invalid values", () => {
    const clock = new DeviceClock();
    clock.sample(0, 100, 200); // 0 server time
    expect(clock.isSynced()).toBe(false);

    clock.sample(1000, 200, 100); // negative rtt
    expect(clock.isSynced()).toBe(false);

    clock.sample(1000, 100, 15000); // > MAX_RTT_MS
    expect(clock.isSynced()).toBe(false);

    clock.sample(NaN, 100, 200);
    expect(clock.isSynced()).toBe(false);
  });

  test("sample sets anchor with best rtt", () => {
    const clock = new DeviceClock();
    clock.sample(10000, 100, 300); // rtt = 200
    expect(clock.isSynced()).toBe(true);

    // mock monotonic so now() is predictable
    // first sample mid is 200. anchor is 10000. monotonic is 400.
    // 10000 + (400 - 200) = 10200
    const perfSpy = vi.spyOn(performance, "now").mockReturnValue(400);
    expect(clock.now()).toBe(10200);

    // add a better sample
    clock.sample(10150, 200, 250); // rtt = 50, mid = 225
    // anchor is now serverTime 10150, mid 225.
    // monotonic 400. 10150 + (400 - 225) = 10325
    expect(clock.now()).toBe(10325);

    // add a worse sample
    clock.sample(10300, 250, 450); // rtt = 200, should not replace the 50ms rtt anchor
    expect(clock.now()).toBe(10325);

    perfSpy.mockRestore();
  });

  test("snapshot uses current anchor", () => {
    const clock = new DeviceClock();
    clock.sample(10000, 100, 150); // rtt = 50
    const snap = clock.snapshot();
    expect(snap).not.toBeNull();
    expect(snap?.rttMs).toBe(50);
  });
});
