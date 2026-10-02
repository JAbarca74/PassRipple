import { describe, expect, it } from "vitest";
import { formatColones, formatCountdown, formatEventDate, formatEventTime } from "./format.ts";

describe("formatColones", () => {
  it("uses a dot as the thousands separator and no decimals", () => {
    expect(formatColones(0)).toBe("₡0");
    expect(formatColones(350)).toBe("₡350");
    expect(formatColones(5000)).toBe("₡5.000");
    expect(formatColones(10700)).toBe("₡10.700");
    expect(formatColones(1725000)).toBe("₡1.725.000");
  });

  it("puts the sign before the currency symbol", () => {
    expect(formatColones(-15000)).toBe("−₡15.000");
  });

  it("rejects amounts that are not whole colones", () => {
    expect(() => formatColones(10.5)).toThrow(RangeError);
    expect(() => formatColones(Number.NaN)).toThrow(RangeError);
    expect(() => formatColones(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => formatColones(2 ** 53)).toThrow(RangeError);
  });
});

describe("formatEventDate", () => {
  it("shows Costa Rica time, not UTC", () => {
    expect(formatEventDate(new Date("2026-11-14T19:00:00Z"))).toBe("sáb 14 nov · 1:00 p. m.");
  });

  it("keeps the local day when UTC has already moved to the next day", () => {
    expect(formatEventDate(new Date("2027-01-01T05:30:00Z"))).toBe("jue 31 dic · 11:30 p. m.");
  });

  it("writes midnight and noon as 12", () => {
    expect(formatEventTime(new Date("2026-11-15T06:00:00Z"))).toBe("12:00 a. m.");
    expect(formatEventTime(new Date("2026-11-15T18:00:00Z"))).toBe("12:00 p. m.");
    expect(formatEventTime(new Date("2026-11-15T17:59:00Z"))).toBe("11:59 a. m.");
  });

  it("rejects an invalid date", () => {
    expect(() => formatEventDate(new Date("not a date"))).toThrow(RangeError);
  });
});

describe("formatCountdown", () => {
  it("shows minutes and seconds", () => {
    expect(formatCountdown(1781)).toBe("29:41");
    expect(formatCountdown(24)).toBe("00:24");
    expect(formatCountdown(3600)).toBe("60:00");
  });

  it("never shows a negative or partial second", () => {
    expect(formatCountdown(-5)).toBe("00:00");
    expect(formatCountdown(9.99)).toBe("00:09");
    expect(formatCountdown(Number.NaN)).toBe("00:00");
  });
});
