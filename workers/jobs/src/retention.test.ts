import { describe, expect, test, vi } from "vitest";
import type { Database, Tx } from "./db.ts";
import { DEFAULT_RETENTION_DAYS, isHourly, purgeDocuments, retentionDays } from "./retention.ts";

describe("retentionDays", () => {
  test("defaults to 30 days when unset", () => {
    expect(retentionDays(undefined)).toBe(DEFAULT_RETENTION_DAYS);
    expect(retentionDays(" ")).toBe(DEFAULT_RETENTION_DAYS);
  });

  test("reads a whole number of days, zero included", () => {
    expect(retentionDays("90")).toBe(90);
    expect(retentionDays("0")).toBe(0);
  });

  test("refuses anything else instead of guessing", () => {
    for (const raw of ["-1", "1.5", "treinta", "99999"]) expect(retentionDays(raw)).toBeNull();
  });
});

describe("isHourly", () => {
  test("only the run at minute 0", () => {
    expect(isHourly(Date.UTC(2026, 10, 11, 3, 0, 0))).toBe(true);
    expect(isHourly(Date.UTC(2026, 10, 11, 3, 1, 0))).toBe(false);
  });
});

describe("purgeDocuments", () => {
  test("calls ticketing.purge_attendee_documents as the system with the period", async () => {
    const calls: { sql: string; values: unknown[] }[] = [];
    const tx = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push({ sql: strings.join("?").replace(/\s+/g, " ").trim(), values });
      return [{ count: 4 }];
    }) as unknown as Tx;
    const system = vi.fn((work: (tx: Tx) => Promise<unknown>) => work(tx));
    const db = { system, close: async () => {} } as unknown as Database;

    await expect(purgeDocuments(db, 30)).resolves.toBe(4);
    expect(system).toHaveBeenCalledOnce();
    expect(calls).toEqual([
      { sql: "SELECT ticketing.purge_attendee_documents(?) AS count", values: [30] },
    ]);
  });
});
