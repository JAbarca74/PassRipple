// The outbox's vocabulary and the ports it is built from. The package does no I/O of its
// own (rule R4): storage, transport, clock and randomness are injected, so the same queue
// runs on op-sqlite in the gate app and in memory under test.

/** Where an operation is in its life: pending → sending → acked, or quarantined. */
export type OutboxState = "pending" | "sending" | "acked" | "quarantined";

/** An operation as the caller hands it over. The payload is opaque to the outbox. */
export interface NewOperation<P> {
  /** Device-generated UUIDv7: the server applies each id once. */
  readonly id: string;
  /** What the operation is, for the server (`redemption`, `incident`…). */
  readonly opType: string;
  readonly payload: P;
  /** Device wall clock when it happened, in milliseconds. */
  readonly createdAt: number;
  /** The device's clock correction at that moment, in milliseconds. */
  readonly clockOffsetMs: number;
}

/** An operation in the queue. */
export interface OutboxEntry<P> extends NewOperation<P> {
  /** The device's monotonic counter: the real order of its operations, never the clock. */
  readonly deviceSeq: number;
  readonly state: OutboxState;
  /** Failed sends so far. */
  readonly attempts: number;
  readonly lastError: string | null;
}

export interface OutboxCounts {
  readonly pending: number;
  readonly sending: number;
  readonly quarantined: number;
}

/**
 * Durable storage. Every method must be durable when its promise resolves (on the device:
 * SQLite in WAL mode with synchronous = FULL), so a forced power-off loses nothing.
 * `Tx` is the store's own transaction handle, passed through untouched: it lets the caller
 * record a scan locally and enqueue it in one transaction.
 */
export interface OutboxStore<P, Tx = unknown> {
  /** Appends an operation with the next device sequence number, in `tx` when given. */
  append(operation: NewOperation<P>, tx?: Tx): Promise<OutboxEntry<P>>;
  /** Up to `limit` pending entries, lowest device sequence number first. */
  pending(limit: number): Promise<readonly OutboxEntry<P>[]>;
  markSending(ids: readonly string[]): Promise<void>;
  markAcked(ids: readonly string[]): Promise<void>;
  /** Back to pending after a failed send, one more attempt counted. */
  markRetry(ids: readonly string[], error: string): Promise<void>;
  /** Set aside for a person to review: the server refused it for good. */
  markQuarantined(id: string, error: string): Promise<void>;
  /** After a restart: entries left in `sending` go back to pending. Returns how many. */
  resetSending(): Promise<number>;
  counts(): Promise<OutboxCounts>;
}

/** The server's verdict on one operation of a batch (design 8.7). */
export type ItemStatus = "applied" | "duplicate" | "rejected";

export interface ItemResult {
  readonly id: string;
  readonly status: ItemStatus;
  readonly error?: string | undefined;
}

/**
 * Sends one batch and returns one result per operation. It throws when the batch did not
 * get through (no network, timeout, server error), and must give up after `timeoutMs`.
 */
export interface Transport<P> {
  send(
    batch: readonly OutboxEntry<P>[],
    options: { readonly timeoutMs: number },
  ): Promise<readonly ItemResult[]>;
}

export interface Clock {
  /** Milliseconds since the epoch. */
  now(): number;
}

export interface Random {
  /** A number in [0, 1). */
  next(): number;
}

export interface OutboxConfig {
  /** Operations per batch, 1 to 100. Default 50. */
  readonly batchSize: number;
  /** Per send. Default 4 000 ms (design 8.8). */
  readonly timeoutMs: number;
  /** Consecutive failed sends that open the circuit. Default 3. */
  readonly breakerThreshold: number;
  /** How long an open circuit waits before a one-operation probe. Default 60 000 ms. */
  readonly breakerCooldownMs: number;
  /** First backoff after a failure, doubled on each one after. Default 2 000 ms. */
  readonly backoffBaseMs: number;
  /** Ceiling of the backoff. Default 60 000 ms. */
  readonly backoffMaxMs: number;
}

export type CircuitState = "closed" | "open" | "half_open";

export interface OutboxStatus extends OutboxCounts {
  readonly circuit: CircuitState;
  readonly consecutiveFailures: number;
  /** When a drain may next send, or null if it may now. */
  readonly nextAttemptAt: number | null;
  readonly lastSuccessAt: number | null;
  readonly lastFailureAt: number | null;
  readonly lastError: string | null;
}

/** What one drain did. */
export type DrainReport =
  | {
      readonly kind: "drained";
      readonly sent: number;
      readonly acked: number;
      readonly quarantined: number;
    }
  | {
      readonly kind: "failed";
      readonly sent: number;
      readonly acked: number;
      readonly error: string;
    }
  | { readonly kind: "waiting"; readonly until: number; readonly circuit: CircuitState }
  | { readonly kind: "busy" };
