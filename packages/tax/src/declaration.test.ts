import type { DeclarationFigures } from "@passripple/contracts";
import { describe, expect, it } from "vitest";
import { computeDeclaration, declarationCsv, nextBusinessDay } from "./index.ts";

function figures(overrides: Partial<DeclarationFigures> = {}): DeclarationFigures {
  return {
    event: {
      id: "11111111-1111-4111-8111-111111111111",
      name: "Baile",
      venue: "Salón",
      startsAt: "2026-11-13T02:00:00.000Z",
      endsAt: "2026-11-13T08:00:00.000Z",
      permitNumber: "P-1",
      emissionAuth: "AUT-X-2026-AAAA1111",
      status: "closed",
      permittedCapacity: 100,
    },
    organization: "Org",
    canton: { code: "X", name: "Cantón X" },
    rules: {
      taxRateBps: 500,
      courtesyDeductBps: { popular: 1000 },
      settlementRule: "next_business_day",
      guaranteeBps: 6000,
      reportFormat: "generic",
    },
    types: [
      {
        name: "General",
        priceCrc: 10000,
        audience: "public",
        online: 60,
        door: 20,
        courtesies: 10,
        redeemed: 70,
        voided: 2,
      },
      {
        name: "VIP",
        priceCrc: 20000,
        audience: "public",
        online: 10,
        door: 0,
        courtesies: 0,
        redeemed: 9,
        voided: 0,
      },
    ],
    duplicateScans: 3,
    capacityIncidents: 0,
    courtesy: { courtesies: 10, entries: 100, deductBps: 1000, limit: 10, excess: 0 },
    logHash: "a".repeat(64),
    generatedAt: "2026-11-13T12:00:00.000Z",
    ...overrides,
  };
}

describe("nextBusinessDay", () => {
  it("returns the next weekday in Costa Rica time", () => {
    // 2026-11-13 is a Friday; 08:00 UTC is 02:00 local the same day: the next working day is Monday.
    expect(nextBusinessDay("2026-11-13T08:00:00.000Z", "next_business_day")).toBe("2026-11-16");
    // Wednesday to Thursday.
    expect(nextBusinessDay("2026-11-11T20:00:00.000Z", "next_business_day")).toBe("2026-11-12");
  });

  it("uses the local day, not the UTC day, at the end of the evening", () => {
    // Thursday 2026-11-12 22:00 local is Friday 04:00 UTC: the local day is still Thursday.
    expect(nextBusinessDay("2026-11-13T04:00:00.000Z", "next_business_day")).toBe("2026-11-13");
  });

  it("skips the weekend from a Saturday", () => {
    expect(nextBusinessDay("2026-11-14T18:00:00.000Z", "next_business_day")).toBe("2026-11-16");
  });

  it("gives no date for a rule it does not know or a bad date", () => {
    expect(nextBusinessDay("2026-11-13T08:00:00.000Z", "other")).toBeNull();
    expect(nextBusinessDay("not a date", "next_business_day")).toBeNull();
  });
});

describe("computeDeclaration", () => {
  it("taxes what was charged online and at the door", () => {
    const result = computeDeclaration(figures());
    expect(result.grossCrc).toBe(80 * 10000 + 10 * 20000);
    expect(result.courtesyExcessCrc).toBe(0);
    expect(result.taxableBaseCrc).toBe(1_000_000);
    expect(result.taxCrc).toBe(50_000);
    expect(result.dueDate).toBe("2026-11-16");
  });

  it("values the courtesies over the limit at the average paid price", () => {
    const result = computeDeclaration(
      figures({
        courtesy: { courtesies: 15, entries: 100, deductBps: 1000, limit: 10, excess: 5 },
      }),
    );
    // Average paid price: 1,000,000 / 90 = 11,111 colones.
    expect(result.courtesyExcessCrc).toBe(5 * 11111);
    expect(result.taxableBaseCrc).toBe(1_000_000 + 55_555);
    expect(result.taxCrc).toBe(Math.round((1_055_555 * 500) / 10000));
  });

  it("is zero for an event with no paid tickets", () => {
    const result = computeDeclaration(
      figures({
        types: [
          {
            name: "Gratis",
            priceCrc: 0,
            audience: "public",
            online: 5,
            door: 0,
            courtesies: 0,
            redeemed: 5,
            voided: 0,
          },
        ],
        courtesy: { courtesies: 0, entries: 5, deductBps: null, limit: null, excess: 0 },
      }),
    );
    expect(result.taxableBaseCrc).toBe(0);
    expect(result.taxCrc).toBe(0);
  });
});

describe("declarationCsv", () => {
  it("has the totals and the hash, with CRLF lines", () => {
    const csv = declarationCsv(computeDeclaration(figures()));
    expect(csv).toContain('"Impuesto (CRC)","50000"');
    expect(csv).toContain(`"Hash de la bitácora (sha256)","${"a".repeat(64)}"`);
    expect(csv.endsWith("\r\n")).toBe(true);
  });

  it("quotes quotes and neutralizes formulas typed by an organizer", () => {
    const base = figures();
    const csv = declarationCsv(
      computeDeclaration({ ...base, event: { ...base.event, name: '=HYPERLINK("x")' } }),
    );
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
  });

  it("has nothing to tax when no ticket was issued", () => {
    const result = computeDeclaration(figures({ types: [] }));
    expect(result.grossCrc).toBe(0);
    expect(result.taxCrc).toBe(0);
  });

  it("leaves empty what the event does not have", () => {
    const base = figures();
    const csv = declarationCsv(
      computeDeclaration({
        ...base,
        event: { ...base.event, permitNumber: null, emissionAuth: null },
        rules: { ...base.rules, settlementRule: "other" },
        courtesy: { courtesies: 0, entries: 0, deductBps: null, limit: null, excess: 0 },
      }),
    );
    expect(csv).toContain('"Permiso",""');
    expect(csv).toContain('"Fecha de liquidación",""');
  });
});
