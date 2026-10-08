import { describe, expect, test } from "vitest";
import { BURST_GAP_MS, ManualEntryLimiter, REPEAT_WINDOW_MS, ScanSession } from "./scan-session.ts";

describe("ScanSession.isNewRead", () => {
  test("returns true on first read", () => {
    const session = new ScanSession();
    expect(session.isNewRead("text1", 1000)).toBe(true);
  });

  test("returns false on repeated read within window and updates timer", () => {
    const session = new ScanSession();
    session.isNewRead("text1", 1000);
    expect(session.isNewRead("text1", 1000 + REPEAT_WINDOW_MS - 1)).toBe(false);
    
    // the timer is updated, so it needs REPEAT_WINDOW_MS from the last read to be true again
    expect(session.isNewRead("text1", 1000 + 2 * REPEAT_WINDOW_MS - 2)).toBe(false);
    
    expect(session.isNewRead("text1", 1000 + 2 * REPEAT_WINDOW_MS - 1)).toBe(true);
  });

  test("returns true if text changes", () => {
    const session = new ScanSession();
    session.isNewRead("text1", 1000);
    expect(session.isNewRead("text2", 1000)).toBe(true);
  });
});

describe("ScanSession.admitted", () => {
  const k1 = new Uint8Array([1]);
  const k2 = new Uint8Array([2]);

  test("returns null if holderPubkey is null", () => {
    const session = new ScanSession();
    expect(session.admitted("t1", null, 2, 1000)).toBeNull();
  });

  test("groups consecutive admissions of same key in burst", () => {
    const session = new ScanSession();
    expect(session.admitted("t1", k1, 3, 1000)).toEqual({ admitted: 1, total: 3 });
    expect(session.admitted("t2", k1, 3, 1000 + BURST_GAP_MS - 1)).toEqual({ admitted: 2, total: 3 });
    
    // same ticket id doesn't increment admitted again
    expect(session.admitted("t2", k1, 3, 1000 + BURST_GAP_MS)).toEqual({ admitted: 2, total: 3 });
  });

  test("resets burst on different key", () => {
    const session = new ScanSession();
    session.admitted("t1", k1, 2, 1000);
    expect(session.admitted("t2", k2, 2, 1000)).toEqual({ admitted: 1, total: 2 });
  });

  test("resets burst if gap exceeded", () => {
    const session = new ScanSession();
    session.admitted("t1", k1, 2, 1000);
    expect(session.admitted("t2", k1, 2, 1000 + BURST_GAP_MS)).toEqual({ admitted: 1, total: 2 });
  });

  test("caps total to at least admitted", () => {
    const session = new ScanSession();
    // Suppose total is given as 1, but we admit 2
    session.admitted("t1", k1, 1, 1000);
    expect(session.admitted("t2", k1, 1, 1000)).toEqual({ admitted: 2, total: 2 });
  });
});

describe("ManualEntryLimiter", () => {
  test("locks after 5 failures and doubles lock time", () => {
    const limiter = new ManualEntryLimiter();
    
    expect(limiter.lockedFor(1000)).toBe(0);
    expect(limiter.fail(1000)).toBe(false);
    expect(limiter.fail(1000)).toBe(false);
    expect(limiter.fail(1000)).toBe(false);
    expect(limiter.fail(1000)).toBe(false);
    
    // 5th failure
    expect(limiter.fail(1000)).toBe(true);
    expect(limiter.lockedFor(1000)).toBe(60_000);
    expect(limiter.lockedFor(61_000)).toBe(0);
    
    // fail 5 more times
    limiter.fail(61_000);
    limiter.fail(61_000);
    limiter.fail(61_000);
    limiter.fail(61_000);
    expect(limiter.fail(61_000)).toBe(true);
    
    // second lock is 120_000
    expect(limiter.lockedFor(61_000)).toBe(120_000);
  });

  test("succeed resets failures but not lock multiplier", () => {
    const limiter = new ManualEntryLimiter();
    limiter.fail(1000);
    limiter.fail(1000);
    limiter.succeed();
    
    expect(limiter.fail(1000)).toBe(false);
    expect(limiter.fail(1000)).toBe(false);
    expect(limiter.fail(1000)).toBe(false);
    expect(limiter.fail(1000)).toBe(false);
    expect(limiter.fail(1000)).toBe(true); // 5th since succeed
  });
});
