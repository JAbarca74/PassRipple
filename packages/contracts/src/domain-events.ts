// Domain events: how a lower module tells higher ones that something happened (rule R3).
// Each event is a plain object with a `type` discriminator. Ids are UUID strings and
// times are ISO 8601 strings, so every event survives JSON unchanged.

/** An event went on sale. inventory creates its capacity counter from it. */
export interface EventPublished {
  type: "event.published";
  eventId: string;
  orgId: string;
  permittedCapacity: number;
  occurredAt: string;
}

/** An event's data changed, such as its permitted capacity or its status. */
export interface EventUpdated {
  type: "event.updated";
  eventId: string;
  orgId: string;
  permittedCapacity: number;
  occurredAt: string;
}

/** An event was cancelled before it closed. */
export interface EventCancelled {
  type: "event.cancelled";
  eventId: string;
  orgId: string;
  occurredAt: string;
}

/** A bank notice became the payment of an order, and the order is paid. */
export interface PaymentSucceeded {
  type: "payment.succeeded";
  paymentId: string;
  orderId: string;
  eventId: string;
  amountCrc: number;
  occurredAt: string;
}

/** A ticket was issued: sold, complimentary or pre-issued for a door-sale block. */
export interface TicketIssued {
  type: "ticket.issued";
  ticketId: string;
  eventId: string;
  orderId: string | null;
  origin: "sale" | "courtesy" | "door_sale";
  occurredAt: string;
}

/** A ticket was voided. Voids happen online only. */
export interface TicketVoided {
  type: "ticket.voided";
  ticketId: string;
  eventId: string;
  occurredAt: string;
}

/** Every domain event in the catalog. */
export type DomainEvent =
  | EventPublished
  | EventUpdated
  | EventCancelled
  | PaymentSucceeded
  | TicketIssued
  | TicketVoided;

/** The `type` of every domain event. */
export type DomainEventType = DomainEvent["type"];
