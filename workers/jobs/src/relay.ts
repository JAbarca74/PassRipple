// The relay of domain events (ADR 0029): for each module that keeps an outbox, claims the
// unpublished rows, sends them to the queue and marks them published, all in one
// transaction. A failed send rolls back and the rows wait for the next run; a crash after
// the send publishes them again, which consumers absorb by the envelope's id.

import {
  type DomainEventEnvelope,
  domainEvent,
  EVENT_SOURCES,
  type EventSource,
} from "@passripple/contracts";
import type { Database, Tx } from "./db.ts";

/** Rows per outbox per run; a Queue batch takes at most 100 messages. */
const BATCH = 100;

interface OutboxRow {
  id: string;
  type: string;
  payload: unknown;
}

// One query per source, written out: schema names never come from data.
function claim(tx: Tx, source: EventSource): Promise<OutboxRow[]> {
  switch (source) {
    case "orders":
      return tx<OutboxRow[]>`SELECT * FROM orders.outbox_claim(${BATCH})`;
    case "payments":
      return tx<OutboxRow[]>`SELECT * FROM payments.outbox_claim(${BATCH})`;
    case "ticketing":
      return tx<OutboxRow[]>`SELECT * FROM ticketing.outbox_claim(${BATCH})`;
  }
}

async function markPublished(tx: Tx, source: EventSource, rowIds: string[]): Promise<void> {
  // Without fetch_types, Postgres.js cannot serialize arrays: send the literal. The ids
  // come from the database as UUIDs, so the literal needs no quoting.
  const ids = `{${rowIds.join(",")}}`;
  switch (source) {
    case "orders":
      await tx`SELECT orders.outbox_mark_published(${ids}::uuid[])`;
      return;
    case "payments":
      await tx`SELECT payments.outbox_mark_published(${ids}::uuid[])`;
      return;
    case "ticketing":
      await tx`SELECT ticketing.outbox_mark_published(${ids}::uuid[])`;
      return;
  }
}

/** Publishes one batch of one outbox. Returns how many events it published. */
async function relayOnce(
  db: Database,
  queue: Queue<DomainEventEnvelope>,
  source: EventSource,
): Promise<number> {
  return db.system(async (tx) => {
    const rows = await claim(tx, source);
    if (rows.length === 0) return 0;
    const messages: MessageSendRequest<DomainEventEnvelope>[] = [];
    for (const row of rows) {
      // An event the catalog does not know is a bug in a migration: stop and say so,
      // rather than publish what no consumer can read.
      const event = domainEvent.parse(row.payload);
      messages.push({ body: { id: row.id, source, event }, contentType: "json" });
    }
    await queue.sendBatch(messages);
    await markPublished(
      tx,
      source,
      rows.map((row) => row.id),
    );
    return rows.length;
  });
}

/** Publishes every outbox until it is empty or the run has done enough. */
export async function relay(
  db: Database,
  queue: Queue<DomainEventEnvelope>,
  maxBatchesPerSource = 10,
): Promise<Record<EventSource, number>> {
  const published = { orders: 0, payments: 0, ticketing: 0 } satisfies Record<EventSource, number>;
  for (const source of EVENT_SOURCES) {
    for (let batch = 0; batch < maxBatchesPerSource; batch++) {
      const count = await relayOnce(db, queue, source);
      published[source] += count;
      if (count < BATCH) break;
    }
  }
  return published;
}
