import { describe, expect, test } from "vitest";
import {
  manualNoticeRequest,
  manualNoticeResponse,
  RECONCILE_RESULTS,
  STATEMENT_FINDINGS,
  statementImportRequest,
  statementImportResponse,
  statementLine,
} from "./payments.ts";

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

  describe("statementLine", () => {
    const baseLine = {
      bookedOn: "2026-11-07",
      reference: "STMT-001",
      amountCrc: 5000,
    };

    test("accepts valid statementLine and defaults description to null", () => {
      const parsed = statementLine.parse(baseLine);
      expect(parsed).toEqual({
        ...baseLine,
        description: null,
      });
    });

    test("transforms empty and whitespace description to null, trims non-empty text", () => {
      expect(statementLine.parse({ ...baseLine, description: "" }).description).toBeNull();
      expect(statementLine.parse({ ...baseLine, description: "   " }).description).toBeNull();
      expect(statementLine.parse({ ...baseLine, description: "  pago  " }).description).toBe(
        "pago",
      );
    });

    test("rejects control and format characters in description", () => {
      const forbidden = ["\n", "\t", "\u0000", "\u202E", "\u200B"];
      for (const char of forbidden) {
        expect(() =>
          statementLine.parse({ ...baseLine, description: `line${char}test` }),
        ).toThrow();
      }
    });

    test("enforces length bounds on description (max 500)", () => {
      expect(statementLine.parse({ ...baseLine, description: "x".repeat(500) }).description).toBe(
        "x".repeat(500),
      );
      expect(() => statementLine.parse({ ...baseLine, description: "x".repeat(501) })).toThrow();
    });

    test("validates reference format ^[0-9A-Za-z-]{1,64}$", () => {
      expect(statementLine.parse({ ...baseLine, reference: "A".repeat(64) }).reference).toBe(
        "A".repeat(64),
      );
      expect(() => statementLine.parse({ ...baseLine, reference: "" })).toThrow();
      expect(() => statementLine.parse({ ...baseLine, reference: "   " })).toThrow();
      expect(() => statementLine.parse({ ...baseLine, reference: "A".repeat(65) })).toThrow();
      expect(() => statementLine.parse({ ...baseLine, reference: "REF_123" })).toThrow();
      expect(() => statementLine.parse({ ...baseLine, reference: "REF 123" })).toThrow();
    });

    test("validates amountCrc bounds (1..100000000) and integers", () => {
      expect(statementLine.parse({ ...baseLine, amountCrc: 1 }).amountCrc).toBe(1);
      expect(statementLine.parse({ ...baseLine, amountCrc: 100_000_000 }).amountCrc).toBe(
        100_000_000,
      );

      expect(() => statementLine.parse({ ...baseLine, amountCrc: 0 })).toThrow();
      expect(() => statementLine.parse({ ...baseLine, amountCrc: -1 })).toThrow();
      expect(() => statementLine.parse({ ...baseLine, amountCrc: 1.5 })).toThrow();
      expect(() => statementLine.parse({ ...baseLine, amountCrc: 100_000_001 })).toThrow();
    });

    test("requires valid ISO date for bookedOn", () => {
      expect(() => statementLine.parse({ ...baseLine, bookedOn: "not-a-date" })).toThrow();
      expect(() =>
        statementLine.parse({ ...baseLine, bookedOn: "2026-11-07T12:00:00Z" }),
      ).toThrow();
    });
  });

  describe("statementImportRequest", () => {
    const validLines = [
      {
        bookedOn: "2026-11-05",
        reference: "REF-1",
        amountCrc: 1000,
        description: "Credit 1",
      },
      {
        bookedOn: "2026-11-07",
        reference: "REF-2",
        amountCrc: 2000,
      },
    ];

    test("accepts valid request where from <= to", () => {
      const parsed = statementImportRequest.parse({
        from: "2026-11-01",
        to: "2026-11-07",
        lines: validLines,
      });
      expect(parsed.from).toBe("2026-11-01");
      expect(parsed.to).toBe("2026-11-07");
      expect(parsed.lines).toHaveLength(2);

      // Same day from == to
      const sameDay = statementImportRequest.parse({
        from: "2026-11-07",
        to: "2026-11-07",
        lines: [validLines[1]],
      });
      expect(sameDay.from).toBe("2026-11-07");
    });

    test("rejects when from > to", () => {
      expect(() =>
        statementImportRequest.parse({
          from: "2026-11-08",
          to: "2026-11-07",
          lines: validLines,
        }),
      ).toThrow("from is after to");
    });

    test("rejects invalid ISO dates in from or to", () => {
      expect(() =>
        statementImportRequest.parse({
          from: "invalid",
          to: "2026-11-07",
          lines: validLines,
        }),
      ).toThrow();
      expect(() =>
        statementImportRequest.parse({
          from: "2026-11-01",
          to: "invalid",
          lines: validLines,
        }),
      ).toThrow();
    });

    test("enforces maximum 5000 lines", () => {
      const line = {
        bookedOn: "2026-11-07",
        reference: "REF-BULK",
        amountCrc: 1000,
      };

      const atLimit = Array.from({ length: 5000 }, () => line);
      expect(
        statementImportRequest.parse({
          from: "2026-11-01",
          to: "2026-11-07",
          lines: atLimit,
        }).lines,
      ).toHaveLength(5000);

      const overLimit = Array.from({ length: 5001 }, () => line);
      expect(() =>
        statementImportRequest.parse({
          from: "2026-11-01",
          to: "2026-11-07",
          lines: overLimit,
        }),
      ).toThrow();
    });
  });

  describe("statementImportResponse", () => {
    test("accepts valid response and validates STATEMENT_FINDINGS", () => {
      expect(STATEMENT_FINDINGS).toEqual(["missing", "amount_differs"]);

      const response = {
        statementId: "12345678-1234-4234-8234-123456789012",
        findings: [
          {
            orderCode: "28T5CW",
            reference: "R2",
            amountCrc: 999,
            paidOn: "2026-11-07",
            finding: "amount_differs" as const,
          },
          {
            orderCode: "39U6DX",
            reference: "R3",
            amountCrc: 1000,
            paidOn: "2026-11-07",
            finding: "missing" as const,
          },
        ],
      };
      expect(statementImportResponse.parse(response)).toEqual(response);
    });

    test("rejects invalid finding", () => {
      expect(() =>
        statementImportResponse.parse({
          statementId: "12345678-1234-4234-8234-123456789012",
          findings: [
            {
              orderCode: "28T5CW",
              reference: "R2",
              amountCrc: 999,
              paidOn: "2026-11-07",
              finding: "unknown_finding",
            },
          ],
        }),
      ).toThrow();
    });
  });
});
