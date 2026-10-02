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

/** Every domain event in the catalog. */
export type DomainEvent = EventPublished | EventUpdated | EventCancelled;

/** The `type` of every domain event. */
export type DomainEventType = DomainEvent["type"];
