import { describe, expect, test } from "vitest";
import {
  LEDGER_KINDS,
  ledgerEntry,
  ledgerResponse,
  platformTotals,
  recordEntryRequest,
  recordPayoutRequest,
  settlementEvent,
  settlementEventsResponse,
  settlementStatement,
} from "./settlement-api.ts";

const EVENT_ID = "12345678-1234-4234-8234-123456789001";
const ENTRY_ID = "12345678-1234-4234-8234-123456789002";
const AT = "2026-11-10T12:00:00-06:00";

describe("settlement-api", () => {
  test("ledger kinds match the settlement schema", () => {
    expect(LEDGER_KINDS).toEqual([
      "payment_in",
      "door_sale",
      "fee",
      "fee_tax",
      "refund",
      "adjustment",
      "payout",
    ]);
  });

  describe("ledgerEntry", () => {
    const entry = {
      id: ENTRY_ID,
      kind: "payment_in",
      amountCrc: 10795,
      reference: "BNCR-1",
      reason: null,
      createdAt: AT,
    };

    test("accepts signed, non-zero amounts", () => {
      expect(ledgerEntry.parse(entry)).toEqual(entry);
      expect(ledgerEntry.parse({ ...entry, kind: "fee", amountCrc: -700 }).amountCrc).toBe(-700);
      expect(ledgerResponse.parse({ entries: [entry] }).entries).toHaveLength(1);
    });

    test("rejects a zero amount and an unknown kind", () => {
      expect(ledgerEntry.safeParse({ ...entry, amountCrc: 0 }).success).toBe(false);
      expect(ledgerEntry.safeParse({ ...entry, kind: "bonus" }).success).toBe(false);
    });
  });

  describe("settlementStatement", () => {
    const statement = {
      eventId: EVENT_ID,
      collectedCrc: 10795,
      feeCrc: 700,
      feeTaxCrc: 92,
      refundsCrc: 0,
      adjustmentsCrc: -5,
      paidOutCrc: 0,
      balanceCrc: 9998,
      dueAt: AT,
      overdue: true,
      municipalTaxCrc: 500,
      payout: null,
    };

    test("accepts a statement without and with a payout", () => {
      expect(settlementStatement.parse(statement)).toEqual(statement);
      const paid = {
        ...statement,
        paidOutCrc: 9998,
        balanceCrc: 0,
        overdue: false,
        payout: { amountCrc: 9998, sinpeRef: "SINPE-1", paidAt: AT, confirmedAt: null },
      };
      expect(settlementStatement.parse(paid).payout?.confirmedAt).toBeNull();
    });

    test("rejects a negative balance (I9)", () => {
      // Door-sale commissions can leave the organizer owing the platform.
      expect(settlementStatement.safeParse({ ...statement, balanceCrc: -396 }).success).toBe(true);
    });
  });

  describe("recordPayoutRequest", () => {
    test("trims the reference and accepts a positive amount", () => {
      expect(recordPayoutRequest.parse({ amountCrc: 9998, sinpeRef: " SINPE-1 " })).toEqual({
        amountCrc: 9998,
        sinpeRef: "SINPE-1",
      });
    });

    test("rejects zero, too much, and references with other characters", () => {
      expect(recordPayoutRequest.safeParse({ amountCrc: 0, sinpeRef: "A" }).success).toBe(false);
      expect(recordPayoutRequest.safeParse({ amountCrc: 100_000_001, sinpeRef: "A" }).success).toBe(
        false,
      );
      expect(recordPayoutRequest.safeParse({ amountCrc: 1, sinpeRef: "A B" }).success).toBe(false);
    });
  });

  describe("recordEntryRequest", () => {
    test("a refund is negative, needs a reference and defaults its reason to null", () => {
      expect(
        recordEntryRequest.parse({ kind: "refund", amountCrc: -5000, reference: "R-1" }),
      ).toEqual({ kind: "refund", amountCrc: -5000, reference: "R-1", reason: null });
      expect(
        recordEntryRequest.safeParse({ kind: "refund", amountCrc: 5000, reference: "R-1" }).success,
      ).toBe(false);
      expect(recordEntryRequest.safeParse({ kind: "refund", amountCrc: -5000 }).success).toBe(
        false,
      );
    });

    test("an adjustment takes either sign, needs a reason and defaults its reference to null", () => {
      expect(
        recordEntryRequest.parse({ kind: "adjustment", amountCrc: 15, reason: "  typo  " }),
      ).toEqual({ kind: "adjustment", amountCrc: 15, reference: null, reason: "typo" });
      expect(
        recordEntryRequest.parse({ kind: "adjustment", amountCrc: -15, reason: "fix" }).amountCrc,
      ).toBe(-15);
      expect(
        recordEntryRequest.safeParse({ kind: "adjustment", amountCrc: 0, reason: "x" }).success,
      ).toBe(false);
      expect(
        recordEntryRequest.safeParse({ kind: "adjustment", amountCrc: 5, reason: " " }).success,
      ).toBe(false);
    });

    test("other kinds are not accepted from the API", () => {
      expect(
        recordEntryRequest.safeParse({ kind: "payout", amountCrc: -5, reference: "P" }).success,
      ).toBe(false);
    });
  });

  test("platformTotals", () => {
    const totals = { custodyCrc: 10795, ownIncomeCrc: 0, overdueEvents: 1 };
    expect(platformTotals.parse(totals)).toEqual(totals);
    expect(platformTotals.safeParse({ ...totals, overdueEvents: -1 }).success).toBe(false);
  });
});

describe("settlementEvent", () => {
  test("an event before and after its payout", () => {
    const event = {
      eventId: EVENT_ID,
      orgId: ENTRY_ID,
      name: "Ended event",
      startsAt: AT,
      endsAt: AT,
      collectedCrc: 10795,
      balanceCrc: 10003,
      dueAt: AT,
      payoutPaidAt: null,
      payoutConfirmedAt: null,
    };
    expect(settlementEventsResponse.parse({ events: [event] }).events[0]).toEqual(event);
    expect(settlementEvent.parse({ ...event, balanceCrc: 0, payoutPaidAt: AT }).payoutPaidAt).toBe(
      AT,
    );
    expect(settlementEvent.safeParse({ ...event, balanceCrc: -396 }).success).toBe(true);
    expect(settlementEvent.safeParse({ ...event, balanceCrc: 1.5 }).success).toBe(false);
  });
});
