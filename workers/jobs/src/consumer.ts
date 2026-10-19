// The queue consumer (ADR 0029): validates each envelope and hands the event to the module
// that handles it. Handlers are idempotent by the envelope's id, so a message delivered
// twice, or after a later one, changes nothing the second time.

import {
  type DomainEventEnvelope,
  decodeDomainEventEnvelope,
  type OrderPaid,
} from "@passripple/contracts";
import { HUMAN_CODE_ENTROPY_BYTES, humanCode } from "@passripple/crypto";
import type { Database } from "./db.ts";

interface OrderLine {
  event_id: string;
  ticket_type_id: string;
  quantity: number;
}

function newTicketCode(): string {
  return humanCode(crypto.getRandomValues(new Uint8Array(HUMAN_CODE_ENTROPY_BYTES)));
}

/**
 * order.paid → ticketing issues the order's tickets. ticketing cannot read orders (rule
 * R2), so the lines are read here through orders and passed on, in one transaction. An
 * order that is not paid has no lines, and nothing is issued.
 */
async function issueOrder(db: Database, messageId: string, event: OrderPaid): Promise<number> {
  return db.system(async (tx) => {
    const lines = await tx<OrderLine[]>`SELECT * FROM orders.paid_order_lines(${event.orderId})`;
    const first = lines[0];
    if (first === undefined) return 0;
    const payload = lines.map((line) => ({
      ticketTypeId: line.ticket_type_id,
      codes: Array.from({ length: line.quantity }, newTicketCode),
    }));
    const [row] = await tx<{ issued: number }[]>`
      SELECT ticketing.issue_order(${messageId}, ${event.orderId}, ${first.event_id},
                                   ${tx.json(payload)}) AS issued`;
    return row?.issued ?? 0;
  });
}

/** Handles one envelope. Events with no consumer yet are acknowledged and dropped. */
export async function handle(db: Database, envelope: DomainEventEnvelope): Promise<void> {
  switch (envelope.event.type) {
    case "order.paid":
      await issueOrder(db, envelope.id, envelope.event);
      return;
    default:
      return;
  }
}

/** One batch from the queue: each message is acknowledged or retried on its own. */
export async function consume(db: Database, batch: MessageBatch<unknown>): Promise<void> {
  for (const message of batch.messages) {
    const envelope = decodeDomainEventEnvelope(message.body);
    if (envelope === null) {
      // Retrying cannot make it valid: let it go to the dead-letter queue for a person.
      console.error(`malformed domain event message ${message.id}`);
      message.retry({ delaySeconds: 60 });
      continue;
    }
    try {
      await handle(db, envelope);
      message.ack();
    } catch (error) {
      console.error(`domain event ${envelope.id} (${envelope.event.type}) failed`, error);
      // Backs off with the attempts: 10 s, 20 s, 40 s…
      message.retry({ delaySeconds: Math.min(10 * 2 ** (message.attempts - 1), 600) });
    }
  }
}
