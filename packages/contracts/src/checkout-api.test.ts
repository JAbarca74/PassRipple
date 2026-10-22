import { describe, expect, test } from "vitest";
import {
  buyerContact,
  createOrderRequest,
  eventSlug,
  idempotencyKey,
  ORDER_TOKEN_PREFIX,
  orderState,
  placedOrder,
  publicEvent,
  publicTicketType,
} from "./checkout-api.ts";

describe("checkout-api", () => {
  describe("buyerContact", () => {
    test("normalizes and lowercases valid email address", () => {
      expect(buyerContact.parse(" Usted@Example.COM ")).toEqual({
        email: "usted@example.com",
      });
    });

    test("formats 8-digit phone numbers with Costa Rica country code +506", () => {
      expect(buyerContact.parse("8888-8888")).toEqual({ phone: "+50688888888" });
      expect(buyerContact.parse("8888 8888")).toEqual({ phone: "+50688888888" });
      expect(buyerContact.parse("(8888) 8888")).toEqual({ phone: "+50688888888" });
      expect(buyerContact.parse("8888.8888")).toEqual({ phone: "+50688888888" });
    });

    test("accepts international phone numbers with leading plus and cleans formatting", () => {
      expect(buyerContact.parse("+50688888888")).toEqual({ phone: "+50688888888" });
      expect(buyerContact.parse("+1 (555) 010-9999")).toEqual({ phone: "+15550109999" });
    });

    test("rejects invalid contact inputs", () => {
      expect(() => buyerContact.parse("8888")).toThrow();
      expect(() => buyerContact.parse("a@")).toThrow();
      expect(() => buyerContact.parse("@example.com")).toThrow();
      expect(() => buyerContact.parse("")).toThrow();
      expect(() => buyerContact.parse("   ")).toThrow();
      expect(() => buyerContact.parse("a".repeat(255))).toThrow();
      expect(() => buyerContact.parse("+1234567")).toThrow();
      expect(() => buyerContact.parse("+1234567890123456")).toThrow();
    });
  });

  describe("idempotencyKey", () => {
    test("accepts 22 and 128 characters of base64url characters", () => {
      const min22 = "A".repeat(22);
      const max128 = "A".repeat(128);
      expect(idempotencyKey.parse(min22)).toBe(min22);
      expect(idempotencyKey.parse(max128)).toBe(max128);
    });

    test("rejects 21, 129, and forbidden punctuation", () => {
      expect(() => idempotencyKey.parse("A".repeat(21))).toThrow();
      expect(() => idempotencyKey.parse("A".repeat(129))).toThrow();
      expect(() => idempotencyKey.parse(`${"A".repeat(21)}=`)).toThrow();
      expect(() => idempotencyKey.parse(`${"A".repeat(21)}.`)).toThrow();
    });
  });

  describe("eventSlug", () => {
    test("accepts valid kebab-case slug", () => {
      expect(eventSlug.parse("fiesta-de-palmares")).toBe("fiesta-de-palmares");
    });

    test("rejects uppercase, leading or trailing hyphens, double hyphens, and invalid lengths", () => {
      expect(() => eventSlug.parse("Fiesta-de-palmares")).toThrow();
      expect(() => eventSlug.parse("-fiesta-de-palmares")).toThrow();
      expect(() => eventSlug.parse("fiesta-de-palmares-")).toThrow();
      expect(() => eventSlug.parse("fiesta--palmares")).toThrow();
      expect(() => eventSlug.parse("ab")).toThrow();
      expect(() => eventSlug.parse("a".repeat(81))).toThrow();
    });
  });

  describe("createOrderRequest", () => {
    const baseOrder = {
      eventId: "12345678-1234-4234-8234-123456789012",
      ticketTypeId: "12345678-1234-4234-8234-123456789013",
      quantity: 2,
      contact: "buyer@example.com",
      termsVersion: "v1.0",
      privacyVersion: "v1.0",
    };

    test("defaults marketing to false when omitted", () => {
      const parsed = createOrderRequest.parse(baseOrder);
      expect(parsed.marketing).toBe(false);
    });

    test("preserves marketing when set to true", () => {
      const parsed = createOrderRequest.parse({ ...baseOrder, marketing: true });
      expect(parsed.marketing).toBe(true);
    });

    test("rejects invalid quantity values (0, 101, non-integers)", () => {
      expect(() => createOrderRequest.parse({ ...baseOrder, quantity: 0 })).toThrow();
      expect(() => createOrderRequest.parse({ ...baseOrder, quantity: 101 })).toThrow();
      expect(() => createOrderRequest.parse({ ...baseOrder, quantity: 1.5 })).toThrow();
    });
  });

  describe("placedOrder", () => {
    const validPlaced = {
      token: `${ORDER_TOKEN_PREFIX}secrettoken1234567890`,
      orderCode: "28T5CW",
      status: "pending" as const,
      amountCrc: 5000,
      amountUnique: true,
      sinpeNumber: "+50688888888",
      expiresAt: "2026-10-21T12:00:00-06:00",
    };

    test("accepts valid placed order", () => {
      expect(placedOrder.parse(validPlaced)).toEqual(validPlaced);
    });

    test("rejects token that does not start with ORDER_TOKEN_PREFIX", () => {
      expect(() =>
        placedOrder.parse({ ...validPlaced, token: "other_secrettoken1234567890" }),
      ).toThrow();
    });
  });

  describe("orderState", () => {
    const validState = {
      orderCode: "28T5CW",
      status: "pending" as const,
      amountCrc: 5000,
      expiresAt: "2026-10-21T12:00:00-06:00",
      paidAt: null,
    };

    test("accepts paidAt as null", () => {
      expect(orderState.parse(validState).paidAt).toBeNull();
    });

    test("accepts paidAt with timezone offset", () => {
      const withPaidAt = { ...validState, paidAt: "2026-10-21T12:05:00-06:00" };
      expect(orderState.parse(withPaidAt).paidAt).toBe("2026-10-21T12:05:00-06:00");
    });

    test("rejects expiresAt without timezone", () => {
      expect(() => orderState.parse({ ...validState, expiresAt: "2026-10-21T12:00:00" })).toThrow();
    });
  });

  describe("publicTicketType and publicEvent", () => {
    const validTicketType = {
      id: "12345678-1234-4234-8234-123456789012",
      name: "General",
      zone: null,
      priceCrc: 10000,
      serviceChargeCrc: 1000,
      availability: "available" as const,
    };

    test("validates public ticket type", () => {
      expect(publicTicketType.parse(validTicketType)).toEqual(validTicketType);
      expect(() =>
        publicTicketType.parse({ ...validTicketType, availability: "unknown" }),
      ).toThrow();
    });

    test("validates public event", () => {
      const validEvent = {
        event: {
          id: "12345678-1234-4234-8234-123456789010",
          slug: "concierto-verano",
          name: "Concierto Verano",
          venueName: "Estadio Nacional",
          startsAt: "2026-12-01T18:00:00-06:00",
          endsAt: "2026-12-01T23:00:00-06:00",
          ageRating: "all" as const,
        },
        ticketTypes: [validTicketType],
        legal: { termsVersion: "v1", privacyVersion: "v1" },
      };
      expect(publicEvent.parse(validEvent)).toEqual(validEvent);
    });
  });
});
