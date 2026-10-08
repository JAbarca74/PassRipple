import { describe, expect, test } from "vitest";
import { gateBatchItemResult, gateBatchRequest, gateBatchResponse } from "./gate-operations.ts";

describe("gate-operations", () => {
  describe("gateBatchRequest", () => {
    test("accepts 1 to 100 items with a text id and allows unknown fields", () => {
      const one = { items: [{ id: "123", extra: "field" }] };
      expect(gateBatchRequest.parse(one)).toEqual(one);

      const hundred = { items: Array.from({ length: 100 }, (_, i) => ({ id: `id-${i}`, extra: i })) };
      expect(gateBatchRequest.parse(hundred)).toEqual(hundred);
    });

    test("rejects 0 or 101 items, and items without id", () => {
      expect(() => gateBatchRequest.parse({ items: [] })).toThrow();
      const hundredOne = { items: Array.from({ length: 101 }, (_, i) => ({ id: `id-${i}` })) };
      expect(() => gateBatchRequest.parse(hundredOne)).toThrow();

      expect(() => gateBatchRequest.parse({ items: [{ noId: "here" }] })).toThrow();
    });
  });

  describe("gateBatchItemResult", () => {
    test("accepts valid statuses", () => {
      expect(gateBatchItemResult.parse({ id: "1", status: "applied" })).toEqual({ id: "1", status: "applied" });
      expect(gateBatchItemResult.parse({ id: "2", status: "duplicate", outcome: "duplicate" })).toEqual({ id: "2", status: "duplicate", outcome: "duplicate" });
      expect(gateBatchItemResult.parse({ id: "3", status: "rejected", error: "bad" })).toEqual({ id: "3", status: "rejected", error: "bad" });
      expect(gateBatchItemResult.parse({ id: "4", status: "applied", outcome: "admitted" })).toEqual({ id: "4", status: "applied", outcome: "admitted" });
    });

    test("rejects invalid statuses or missing id", () => {
      expect(() => gateBatchItemResult.parse({ id: "1", status: "unknown" })).toThrow();
      expect(() => gateBatchItemResult.parse({ status: "applied" })).toThrow();
    });
  });

  describe("gateBatchResponse", () => {
    test("accepts valid responses", () => {
      const valid = {
        results: [
          { id: "1", status: "applied" as const },
          { id: "2", status: "rejected" as const, error: "invalid" }
        ],
        serverTime: 1700000000000
      };
      expect(gateBatchResponse.parse(valid)).toEqual(valid);
    });

    test("rejects invalid responses", () => {
      expect(() => gateBatchResponse.parse({ results: [], serverTime: -1 })).toThrow();
      expect(() => gateBatchResponse.parse({ results: [{ status: "applied" }], serverTime: 1 })).toThrow();
    });
  });
});
