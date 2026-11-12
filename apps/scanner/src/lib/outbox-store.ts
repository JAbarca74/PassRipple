// The outbox's storage on op-sqlite (design 8.6). Each method commits before it resolves,
// and the database runs WAL with synchronous = FULL, so what was queued survives a forced
// power-off. The device sequence number is assigned inside the insert, in the same
// transaction as whatever the caller did with `tx`.

import type { DB, Transaction } from "@op-engineering/op-sqlite";
import type { GateOperation } from "@passripple/contracts";
import type {
  NewOperation,
  OutboxCounts,
  OutboxEntry,
  OutboxState,
  OutboxStore,
} from "@passripple/outbox";

/** What the gate queues: an operation's type-specific payload. */
export type GatePayload = GateOperation["payload"];

function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

function rowToEntry(row: Record<string, unknown>): OutboxEntry<GatePayload> {
  return {
    id: String(row.id),
    deviceSeq: Number(row.device_seq),
    opType: String(row.op_type),
    payload: JSON.parse(String(row.payload)) as GatePayload,
    createdAt: Number(row.created_at),
    clockOffsetMs: Number(row.clock_offset),
    state: String(row.state) as OutboxState,
    attempts: Number(row.attempts),
    lastError: row.last_error === null ? null : String(row.last_error),
  };
}

export function createOutboxStore(db: DB): OutboxStore<GatePayload, Transaction> {
  async function insert(
    tx: Transaction,
    operation: NewOperation<GatePayload>,
  ): Promise<OutboxEntry<GatePayload>> {
    await tx.execute(
      `INSERT INTO outbox (id, device_seq, op_type, payload, created_at, clock_offset)
       VALUES (?, (SELECT coalesce(max(device_seq), 0) + 1 FROM outbox), ?, ?, ?, ?)`,
      [
        operation.id,
        operation.opType,
        JSON.stringify(operation.payload),
        operation.createdAt,
        operation.clockOffsetMs,
      ],
    );
    const result = await tx.execute("SELECT * FROM outbox WHERE id = ?", [operation.id]);
    const row = result.rows[0];
    if (row === undefined) throw new Error("the queued operation was not stored");
    return rowToEntry(row);
  }

  async function setState(ids: readonly string[], state: OutboxState): Promise<void> {
    if (ids.length === 0) return;
    await db.execute(`UPDATE outbox SET state = ? WHERE id IN (${placeholders(ids.length)})`, [
      state,
      ...ids,
    ]);
  }

  return {
    async append(operation, tx) {
      if (tx !== undefined) return insert(tx, operation);
      let entry: OutboxEntry<GatePayload> | undefined;
      await db.transaction(async (own) => {
        entry = await insert(own, operation);
      });
      if (entry === undefined) throw new Error("the queued operation was not stored");
      return entry;
    },

    async pending(limit) {
      const result = await db.execute(
        "SELECT * FROM outbox WHERE state = 'pending' ORDER BY device_seq LIMIT ?",
        [limit],
      );
      return result.rows.map(rowToEntry);
    },

    markSending: (ids) => setState(ids, "sending"),
    markAcked: (ids) => setState(ids, "acked"),

    async markRetry(ids, error) {
      if (ids.length === 0) return;
      await db.execute(
        `UPDATE outbox SET state = 'pending', attempts = attempts + 1, last_error = ?
          WHERE id IN (${placeholders(ids.length)})`,
        [error.slice(0, 500), ...ids],
      );
    },

    async markQuarantined(id, error) {
      await db.execute("UPDATE outbox SET state = 'quarantined', last_error = ? WHERE id = ?", [
        error.slice(0, 500),
        id,
      ]);
    },

    async resetSending() {
      const result = await db.execute(
        "UPDATE outbox SET state = 'pending' WHERE state = 'sending'",
      );
      return result.rowsAffected;
    },

    async counts(): Promise<OutboxCounts> {
      const result = await db.execute(
        `SELECT sum(CASE WHEN state = 'pending' THEN 1 ELSE 0 END) AS pending,
                sum(CASE WHEN state = 'sending' THEN 1 ELSE 0 END) AS sending,
                sum(CASE WHEN state = 'quarantined' THEN 1 ELSE 0 END) AS quarantined
           FROM outbox`,
      );
      const row = result.rows[0];
      return {
        pending: Number(row?.pending ?? 0),
        sending: Number(row?.sending ?? 0),
        quarantined: Number(row?.quarantined ?? 0),
      };
    },
  };
}
