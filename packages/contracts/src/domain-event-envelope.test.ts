import { describe, expect, test } from "vitest";
import {
  decodeDomainEventEnvelope,
  domainEvent,
  domainEventEnvelope,
  EVENT_SOURCES,
} from "./domain-event-envelope.ts";
import type { DomainEvent } from "./domain-events.ts";

describe("domain-event-envelope", () => {
  const envelopeId = "12345678-1234-4234-8234-123456789012";
  const eventId = "12345678-1234-4234-8234-123456789013";
  const orgId = "12345678-1234-4234-8234-123456789014";
  const orderId = "12345678-1234-4234-8234-123456789015";
  const paymentId = "12345678-1234-4234-8234-123456789016";
  const ticketId = "12345678-1234-4234-8234-123456789017";
  const occurredAt = "2026-10-21T12:00:00-06:00";

  const eventPublished: DomainEvent = {
    type: "event.published",
    eventId,
    orgId,
    permittedCapacity: 500,
    occurredAt,
  };
  const eventUpdated: DomainEvent = {
    type: "event.updated",
    eventId,
    orgId,
    permittedCapacity: 600,
    occurredAt,
  };
  const eventCancelled: DomainEvent = {
    type: "event.cancelled",
    eventId,
    orgId,
    occurredAt,
  };
  const orderPaid: DomainEvent = {
    type: "order.paid",
    orderId,
    eventId,
    occurredAt,
  };
  const orderExpired: DomainEvent = {
    type: "order.expired",
    orderId,
    eventId,
    occurredAt,
  };
  const paymentSucceeded: DomainEvent = {
    type: "payment.succeeded",
    paymentId,
    orderId,
    eventId,
    amountCrc: 5000,
    occurredAt,
  };
  const ticketIssued: DomainEvent = {
    type: "ticket.issued",
    ticketId,
    eventId,
    orderId,
    origin: "sale",
    occurredAt,
  };
  const ticketBound: DomainEvent = {
    type: "ticket.bound",
    ticketId,
    eventId,
    keyVersion: 1,
    reason: "bind",
    occurredAt,
  };
  const ticketTransferred: DomainEvent = {
    type: "ticket.transferred",
    ticketId,
    eventId,
    keyVersion: 2,
    occurredAt,
  };
  const ticketVoided: DomainEvent = {
    type: "ticket.voided",
    ticketId,
    eventId,
    occurredAt,
  };

  const catalogEvents: readonly DomainEvent[] = [
    eventPublished,
    eventUpdated,
    eventCancelled,
    orderPaid,
    orderExpired,
    paymentSucceeded,
    ticketIssued,
    ticketBound,
    ticketTransferred,
    ticketVoided,
  ];

  describe("decodeDomainEventEnvelope for all catalog events across all sources", () => {
    test("decodes each of the 10 catalog event types with every source in EVENT_SOURCES", () => {
      expect(catalogEvents).toHaveLength(10);
      for (const event of catalogEvents) {
        for (const source of EVENT_SOURCES) {
          const body = { id: envelopeId, source, event };
          const decoded = decodeDomainEventEnvelope(body);
          expect(decoded).toEqual(body);
        }
      }
    });

    test("ticket.issued accepts orderId as null for courtesies and door sales", () => {
      const courtesyEvent: DomainEvent = {
        type: "ticket.issued",
        ticketId,
        eventId,
        orderId: null,
        origin: "courtesy",
        occurredAt,
      };
      const doorSaleEvent: DomainEvent = {
        type: "ticket.issued",
        ticketId,
        eventId,
        orderId: null,
        origin: "door_sale",
        occurredAt,
      };

      const decodedCourtesy = decodeDomainEventEnvelope({
        id: envelopeId,
        source: "ticketing",
        event: courtesyEvent,
      });
      expect(decodedCourtesy?.event).toEqual(courtesyEvent);

      const decodedDoorSale = decodeDomainEventEnvelope({
        id: envelopeId,
        source: "ticketing",
        event: doorSaleEvent,
      });
      expect(decodedDoorSale?.event).toEqual(doorSaleEvent);
    });
  });

  describe("decodeDomainEventEnvelope returns null without throwing on invalid inputs", () => {
    test("returns null for non-object bodies (undefined, string, null, number)", () => {
      expect(decodeDomainEventEnvelope(undefined)).toBeNull();
      expect(decodeDomainEventEnvelope("string")).toBeNull();
      expect(decodeDomainEventEnvelope(null)).toBeNull();
      expect(decodeDomainEventEnvelope(12345)).toBeNull();
    });

    test("returns null for unknown event type", () => {
      expect(
        decodeDomainEventEnvelope({
          id: envelopeId,
          source: "orders",
          event: { type: "unknown.type", occurredAt },
        }),
      ).toBeNull();
    });

    test("returns null for source outside EVENT_SOURCES", () => {
      expect(
        decodeDomainEventEnvelope({
          id: envelopeId,
          source: "billing",
          event: eventPublished,
        }),
      ).toBeNull();
    });

    test("returns null when id is not a UUID", () => {
      expect(
        decodeDomainEventEnvelope({
          id: "not-a-uuid",
          source: "orders",
          event: eventPublished,
        }),
      ).toBeNull();
    });

    test("returns null when occurredAt lacks timezone offset", () => {
      expect(
        decodeDomainEventEnvelope({
          id: envelopeId,
          source: "orders",
          event: { ...eventPublished, occurredAt: "2026-10-21T12:00:00" },
        }),
      ).toBeNull();
    });

    test("returns null when permittedCapacity is 0", () => {
      expect(
        decodeDomainEventEnvelope({
          id: envelopeId,
          source: "orders",
          event: { ...eventPublished, permittedCapacity: 0 },
        }),
      ).toBeNull();
    });

    test("returns null when amountCrc is 0", () => {
      expect(
        decodeDomainEventEnvelope({
          id: envelopeId,
          source: "payments",
          event: { ...paymentSucceeded, amountCrc: 0 },
        }),
      ).toBeNull();
    });

    test("returns null when keyVersion is 0", () => {
      expect(
        decodeDomainEventEnvelope({
          id: envelopeId,
          source: "ticketing",
          event: { ...ticketBound, keyVersion: 0 },
        }),
      ).toBeNull();
    });

    test("returns null when origin is outside its allowed list", () => {
      expect(
        decodeDomainEventEnvelope({
          id: envelopeId,
          source: "ticketing",
          event: { ...ticketIssued, origin: "invalid_origin" as "sale" },
        }),
      ).toBeNull();
    });

    test("returns null when reason is outside its allowed list", () => {
      expect(
        decodeDomainEventEnvelope({
          id: envelopeId,
          source: "ticketing",
          event: { ...ticketBound, reason: "invalid_reason" as "bind" },
        }),
      ).toBeNull();
    });

    test("returns null when required fields are missing", () => {
      expect(
        decodeDomainEventEnvelope({
          id: envelopeId,
          source: "orders",
          event: { type: "order.paid", eventId },
        }),
      ).toBeNull();
      expect(
        decodeDomainEventEnvelope({
          source: "orders",
          event: eventPublished,
        }),
      ).toBeNull();
      expect(
        decodeDomainEventEnvelope({
          id: envelopeId,
          event: eventPublished,
        }),
      ).toBeNull();
    });
  });

  describe("direct schema validation", () => {
    test("domainEvent and domainEventEnvelope throw on invalid inputs", () => {
      expect(() => domainEvent.parse({ type: "invalid" })).toThrow();
      expect(() =>
        domainEventEnvelope.parse({
          id: "not-uuid",
          source: "orders",
          event: eventPublished,
        }),
      ).toThrow();
    });
  });
});
