// How a domain event travels between modules on the server (ADR 0029): the emitting module
// writes it to its outbox in the same transaction as the change, a relay publishes it to
// the queue, and consumers receive this envelope. Delivery is at least once, so consumers
// are idempotent by the envelope's id.

import { z } from "zod";
import type { DomainEvent } from "./domain-events.ts";

const isoTime = z.iso.datetime({ offset: true });
const uuid = z.uuid();

const eventSchemas = [
  z.object({
    type: z.literal("event.published"),
    eventId: uuid,
    orgId: uuid,
    permittedCapacity: z.int().positive(),
    occurredAt: isoTime,
  }),
  z.object({
    type: z.literal("event.updated"),
    eventId: uuid,
    orgId: uuid,
    permittedCapacity: z.int().positive(),
    occurredAt: isoTime,
  }),
  z.object({ type: z.literal("event.cancelled"), eventId: uuid, orgId: uuid, occurredAt: isoTime }),
  z.object({ type: z.literal("order.paid"), orderId: uuid, eventId: uuid, occurredAt: isoTime }),
  z.object({ type: z.literal("order.expired"), orderId: uuid, eventId: uuid, occurredAt: isoTime }),
  z.object({
    type: z.literal("payment.succeeded"),
    paymentId: uuid,
    orderId: uuid,
    eventId: uuid,
    amountCrc: z.int().positive(),
    occurredAt: isoTime,
  }),
  z.object({
    type: z.literal("ticket.issued"),
    ticketId: uuid,
    eventId: uuid,
    orderId: uuid.nullable(),
    origin: z.enum(["sale", "courtesy", "door_sale"]),
    occurredAt: isoTime,
  }),
  z.object({
    type: z.literal("ticket.bound"),
    ticketId: uuid,
    eventId: uuid,
    keyVersion: z.int().min(1),
    reason: z.enum(["bind", "recovery"]),
    occurredAt: isoTime,
  }),
  z.object({
    type: z.literal("ticket.transferred"),
    ticketId: uuid,
    eventId: uuid,
    keyVersion: z.int().min(1),
    occurredAt: isoTime,
  }),
  z.object({
    type: z.literal("ticket.voided"),
    ticketId: uuid,
    eventId: uuid,
    occurredAt: isoTime,
  }),
] as const;

/** Any event of the catalog, checked field by field. */
export const domainEvent: z.ZodType<DomainEvent> = z.discriminatedUnion("type", eventSchemas);

/** Schemas whose modules keep an outbox (ADR 0029). */
export const EVENT_SOURCES = ["orders", "payments", "ticketing"] as const;
export type EventSource = (typeof EVENT_SOURCES)[number];

/** What the queue carries: the outbox row's id, the module that emitted it, and the event. */
export interface DomainEventEnvelope {
  /** The outbox row's id: consumers record it to ignore a second delivery. */
  readonly id: string;
  readonly source: EventSource;
  readonly event: DomainEvent;
}

export const domainEventEnvelope: z.ZodType<DomainEventEnvelope> = z.object({
  id: uuid,
  source: z.enum(EVENT_SOURCES),
  event: domainEvent,
});

/** Validates a message from the queue. Returns null when it is not a known envelope. */
export function decodeDomainEventEnvelope(body: unknown): DomainEventEnvelope | null {
  const parsed = domainEventEnvelope.safeParse(body);
  return parsed.success ? parsed.data : null;
}
