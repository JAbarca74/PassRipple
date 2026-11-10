import type { DomainEventEnvelope } from "@passripple/contracts";
import { describe, expect, test, vi } from "vitest";
import { consume, handle } from "./consumer.ts";
import type { Database, Tx } from "./db.ts";

const MESSAGE_ID = "12345678-1234-4234-8234-123456789001";
const ORDER_ID = "12345678-1234-4234-8234-123456789002";
const EVENT_ID = "12345678-1234-4234-8234-123456789003";
const PAYMENT_ID = "12345678-1234-4234-8234-123456789004";
const TICKET_TYPE_ID = "12345678-1234-4234-8234-123456789005";
const ORG_ID = "12345678-1234-4234-8234-123456789006";
const OCCURRED_AT = "2026-11-10T12:00:00-06:00";

interface RecordedQuery {
  sql: string;
  values: unknown[];
}

function fakeDb(handler: (sql: string, values: unknown[]) => unknown = () => []): {
  db: Database;
  queries: RecordedQuery[];
} {
  const queries: RecordedQuery[] = [];
  const tx = Object.assign(
    async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join("?").replace(/\s+/g, " ").trim();
      queries.push({ sql, values });
      return handler(sql, values);
    },
    {
      json: (val: unknown) => val,
    },
  ) as unknown as Tx;

  const db: Database = {
    system: (work) => work(tx),
    close: async () => {},
  };

  return { db, queries };
}

function fakeMessage(
  body: unknown,
  attempts = 1,
): {
  message: Message<unknown>;
  ack: ReturnType<typeof vi.fn>;
  retry: ReturnType<typeof vi.fn>;
} {
  const ack = vi.fn();
  const retry = vi.fn();
  const message = {
    id: MESSAGE_ID,
    timestamp: new Date(),
    body,
    attempts,
    ack,
    retry,
  } as unknown as Message<unknown>;
  return { message, ack, retry };
}

function fakeBatch(messages: Message<unknown>[]): MessageBatch<unknown> {
  return {
    queue: "domain-events",
    messages,
    ackAll: vi.fn(),
    retryAll: vi.fn(),
  } as unknown as MessageBatch<unknown>;
}

describe("consumer", () => {
  test("order.paid queries paid_order_lines and calls ticketing.issue_order", async () => {
    const { db, queries } = fakeDb((sql) => {
      if (sql.includes("orders.paid_order_lines")) {
        return [{ event_id: EVENT_ID, ticket_type_id: TICKET_TYPE_ID, quantity: 2 }];
      }
      if (sql.includes("ticketing.issue_order")) {
        return [{ issued: 2 }];
      }
      return [];
    });

    const envelope: DomainEventEnvelope = {
      id: MESSAGE_ID,
      source: "orders",
      event: {
        type: "order.paid",
        orderId: ORDER_ID,
        eventId: EVENT_ID,
        occurredAt: OCCURRED_AT,
      },
    };

    await handle(db, envelope);

    expect(queries).toHaveLength(2);
    expect(queries[0]?.sql).toContain("orders.paid_order_lines");
    expect(queries[0]?.values).toEqual([ORDER_ID]);
    expect(queries[1]?.sql).toContain("ticketing.issue_order");
    expect(queries[1]?.values[0]).toBe(MESSAGE_ID);
    expect(queries[1]?.values[1]).toBe(ORDER_ID);
    expect(queries[1]?.values[2]).toBe(EVENT_ID);
    const payload = queries[1]?.values[3] as { ticketTypeId: string; codes: string[] }[];
    expect(payload).toHaveLength(1);
    expect(payload[0]?.ticketTypeId).toBe(TICKET_TYPE_ID);
    expect(payload[0]?.codes).toHaveLength(2);
  });

  test("order.paid returns early when order has no paid lines or empty issue result", async () => {
    const emptyLines = fakeDb(() => []);
    const envelope: DomainEventEnvelope = {
      id: MESSAGE_ID,
      source: "orders",
      event: {
        type: "order.paid",
        orderId: ORDER_ID,
        eventId: EVENT_ID,
        occurredAt: OCCURRED_AT,
      },
    };

    await handle(emptyLines.db, envelope);
    expect(emptyLines.queries).toHaveLength(1);

    const emptyIssue = fakeDb((sql) => {
      if (sql.includes("orders.paid_order_lines")) {
        return [{ event_id: EVENT_ID, ticket_type_id: TICKET_TYPE_ID, quantity: 1 }];
      }
      return [];
    });
    await handle(emptyIssue.db, envelope);
    expect(emptyIssue.queries).toHaveLength(2);
  });

  test("payment.succeeded calls settlement.record_sale with the envelope id and event fields", async () => {
    const { db, queries } = fakeDb((sql) => {
      if (sql.includes("settlement.record_sale")) {
        return [{ booked: true }];
      }
      return [];
    });

    const envelope: DomainEventEnvelope = {
      id: MESSAGE_ID,
      source: "payments",
      event: {
        type: "payment.succeeded",
        paymentId: PAYMENT_ID,
        orderId: ORDER_ID,
        eventId: EVENT_ID,
        amountCrc: 7500,
        occurredAt: OCCURRED_AT,
      },
    };

    const { message, ack, retry } = fakeMessage(envelope);
    await consume(db, fakeBatch([message]));

    expect(ack).toHaveBeenCalledOnce();
    expect(retry).not.toHaveBeenCalled();
    expect(queries).toHaveLength(1);
    expect(queries[0]?.sql).toBe("SELECT settlement.record_sale(?, ?, ?, ?, ?) AS booked");
    expect(queries[0]?.values).toEqual([MESSAGE_ID, PAYMENT_ID, ORDER_ID, EVENT_ID, 7500]);

    // Also cover when no row is returned from record_sale
    const emptyBooked = fakeDb(() => []);
    await handle(emptyBooked.db, envelope);
    expect(emptyBooked.queries).toHaveLength(1);
  });

  test("unknown or unhandled event types are still acked", async () => {
    const { db, queries } = fakeDb();
    const unhandledEnvelope: DomainEventEnvelope = {
      id: MESSAGE_ID,
      source: "orders",
      event: {
        type: "event.published",
        eventId: EVENT_ID,
        orgId: ORG_ID,
        permittedCapacity: 100,
        occurredAt: OCCURRED_AT,
      },
    };

    const { message, ack, retry } = fakeMessage(unhandledEnvelope);
    await consume(db, fakeBatch([message]));

    expect(ack).toHaveBeenCalledOnce();
    expect(retry).not.toHaveBeenCalled();
    expect(queries).toHaveLength(0);
  });

  test("malformed message body is retried with 60s delay", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { db, queries } = fakeDb();
    const { message, ack, retry } = fakeMessage({ invalid: true });

    await consume(db, fakeBatch([message]));

    expect(ack).not.toHaveBeenCalled();
    expect(retry).toHaveBeenCalledWith({ delaySeconds: 60 });
    expect(queries).toHaveLength(0);
    errorSpy.mockRestore();
  });

  test("a thrown error during handling retries with exponential backoff", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { db } = fakeDb(() => {
      throw new Error("db connection lost");
    });

    const envelope: DomainEventEnvelope = {
      id: MESSAGE_ID,
      source: "payments",
      event: {
        type: "payment.succeeded",
        paymentId: PAYMENT_ID,
        orderId: ORDER_ID,
        eventId: EVENT_ID,
        amountCrc: 5000,
        occurredAt: OCCURRED_AT,
      },
    };

    const msg1 = fakeMessage(envelope, 1);
    const msg3 = fakeMessage(envelope, 3);
    const msg10 = fakeMessage(envelope, 10);

    await consume(db, fakeBatch([msg1.message, msg3.message, msg10.message]));

    expect(msg1.ack).not.toHaveBeenCalled();
    expect(msg1.retry).toHaveBeenCalledWith({ delaySeconds: 10 });
    expect(msg3.retry).toHaveBeenCalledWith({ delaySeconds: 40 });
    expect(msg10.retry).toHaveBeenCalledWith({ delaySeconds: 600 });
    errorSpy.mockRestore();
  });
});
