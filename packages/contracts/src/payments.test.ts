import { describe, expect, test } from "vitest";
import { manualNoticeRequest, manualNoticeResponse, RECONCILE_RESULTS } from "./payments.ts";

describe("payments", () => {
  const baseNotice = {
    reference: "ABC-123",
    amountCrc: 5000,
    paidAt: "2026-10-21T12:00:00-06:00",
  };

  describe("manualNoticeRequest", () => {
    test("defaults description, payerName, and payerPhone to null when omitted or explicit null", () => {
      const omitted = manualNoticeRequest.parse(baseNotice);
      expect(omitted.description).toBeNull();
      expect(omitted.payerName).toBeNull();
      expect(omitted.payerPhone).toBeNull();

      const explicit = manualNoticeRequest.parse({
        ...baseNotice,
        description: null,
        payerName: null,
        payerPhone: null,
      });
      expect(explicit.description).toBeNull();
      expect(explicit.payerName).toBeNull();
      expect(explicit.payerPhone).toBeNull();
    });

    test("transforms empty or whitespace-only description and payerName to null, and trims non-empty text", () => {
      expect(manualNoticeRequest.parse({ ...baseNotice, description: "" }).description).toBeNull();
      expect(
        manualNoticeRequest.parse({ ...baseNotice, description: "   " }).description,
      ).toBeNull();
      expect(
        manualNoticeRequest.parse({ ...baseNotice, description: "  pago 28T5CW  " }).description,
      ).toBe("pago 28T5CW");

      expect(manualNoticeRequest.parse({ ...baseNotice, payerName: "" }).payerName).toBeNull();
      expect(manualNoticeRequest.parse({ ...baseNotice, payerName: "   " }).payerName).toBeNull();
      expect(
        manualNoticeRequest.parse({ ...baseNotice, payerName: "  Juan Perez  " }).payerName,
      ).toBe("Juan Perez");
    });

    test("rejects control and format characters in description and payerName", () => {
      const forbiddenChars = [
        "\n", // newline
        "\t", // tab
        "\u0000", // null byte (U+0000)
        "\u202E", // right-to-left override (RLO)
        "\u200B", // zero-width space
      ];

      for (const char of forbiddenChars) {
        expect(() =>
          manualNoticeRequest.parse({
            ...baseNotice,
            description: `pago${char}valido`,
          }),
        ).toThrow();

        expect(() =>
          manualNoticeRequest.parse({
            ...baseNotice,
            payerName: `Juan${char}Perez`,
          }),
        ).toThrow();
      }
    });

    test("enforces max length bounds on description and payerName", () => {
      expect(
        manualNoticeRequest.parse({
          ...baseNotice,
          description: "a".repeat(500),
        }).description,
      ).toBe("a".repeat(500));
      expect(() =>
        manualNoticeRequest.parse({
          ...baseNotice,
          description: "a".repeat(501),
        }),
      ).toThrow();

      expect(
        manualNoticeRequest.parse({
          ...baseNotice,
          payerName: "a".repeat(120),
        }).payerName,
      ).toBe("a".repeat(120));
      expect(() =>
        manualNoticeRequest.parse({
          ...baseNotice,
          payerName: "a".repeat(121),
        }),
      ).toThrow();
    });

    test("validates reference format and boundaries", () => {
      expect(
        manualNoticeRequest.parse({ ...baseNotice, reference: "A".repeat(64) }).reference,
      ).toBe("A".repeat(64));
      expect(() => manualNoticeRequest.parse({ ...baseNotice, reference: "ABC 123" })).toThrow();
      expect(() =>
        manualNoticeRequest.parse({ ...baseNotice, reference: "A".repeat(65) }),
      ).toThrow();
      expect(() => manualNoticeRequest.parse({ ...baseNotice, reference: "" })).toThrow();
      expect(() => manualNoticeRequest.parse({ ...baseNotice, reference: "   " })).toThrow();
    });

    test("validates amountCrc boundaries and integers", () => {
      expect(manualNoticeRequest.parse({ ...baseNotice, amountCrc: 100_000_000 }).amountCrc).toBe(
        100_000_000,
      );

      expect(() => manualNoticeRequest.parse({ ...baseNotice, amountCrc: 0 })).toThrow();
      expect(() => manualNoticeRequest.parse({ ...baseNotice, amountCrc: -1 })).toThrow();
      expect(() => manualNoticeRequest.parse({ ...baseNotice, amountCrc: 1.5 })).toThrow();
      expect(() => manualNoticeRequest.parse({ ...baseNotice, amountCrc: 100_000_001 })).toThrow();
    });

    test("validates payerPhone patterns", () => {
      expect(manualNoticeRequest.parse({ ...baseNotice, payerPhone: "88888888" }).payerPhone).toBe(
        "88888888",
      );
      expect(
        manualNoticeRequest.parse({ ...baseNotice, payerPhone: "+50688888888" }).payerPhone,
      ).toBe("+50688888888");

      expect(() => manualNoticeRequest.parse({ ...baseNotice, payerPhone: "8888-8888" })).toThrow();
      expect(() => manualNoticeRequest.parse({ ...baseNotice, payerPhone: "8888888" })).toThrow();
    });

    test("rejects paidAt without timezone offset", () => {
      expect(() =>
        manualNoticeRequest.parse({ ...baseNotice, paidAt: "2026-10-21T12:00:00" }),
      ).toThrow();
    });
  });

  describe("manualNoticeResponse", () => {
    const validNoticeId = "12345678-1234-4234-8234-123456789012";

    test("accepts orderCode as null or string", () => {
      const responseWithNull = {
        noticeId: validNoticeId,
        result: "unmatched" as const,
        orderCode: null,
      };
      expect(manualNoticeResponse.parse(responseWithNull)).toEqual(responseWithNull);

      const responseWithCode = {
        noticeId: validNoticeId,
        result: "paid" as const,
        orderCode: "28T5CW",
      };
      expect(manualNoticeResponse.parse(responseWithCode)).toEqual(responseWithCode);
    });

    test("accepts all results in RECONCILE_RESULTS", () => {
      for (const result of RECONCILE_RESULTS) {
        const response = {
          noticeId: validNoticeId,
          result,
          orderCode: "28T5CW",
        };
        expect(manualNoticeResponse.parse(response)).toEqual(response);
      }
    });

    test("rejects result outside RECONCILE_RESULTS", () => {
      expect(() =>
        manualNoticeResponse.parse({
          noticeId: validNoticeId,
          result: "unknown_reconcile_result",
          orderCode: null,
        }),
      ).toThrow();
    });
  });
});
