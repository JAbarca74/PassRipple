// The durable offline queue (design 8.6 to 8.8). Operations go out FIFO by device sequence
// number, in batches, and each one ends acked or quarantined, never dropped (invariant I6).
// A failed send puts the batch back, backs off exponentially with jitter so many gate
// devices do not hit the server at once, and after three failures in a row opens a circuit
// that waits a minute and then probes with a single operation.
//
// The outbox decides what to send and when it may; the caller decides when to try (every
// two minutes, on resume, when signal returns) by calling drain().

import type {
  CircuitState,
  Clock,
  DrainReport,
  ItemResult,
  NewOperation,
  OutboxConfig,
  OutboxEntry,
  OutboxStatus,
  OutboxStore,
  Random,
  Transport,
} from "./types.ts";

export const DEFAULT_CONFIG: OutboxConfig = {
  batchSize: 50,
  timeoutMs: 4_000,
  breakerThreshold: 3,
  breakerCooldownMs: 60_000,
  backoffBaseMs: 2_000,
  backoffMaxMs: 60_000,
};

export interface OutboxDeps<P, Tx> {
  readonly store: OutboxStore<P, Tx>;
  readonly transport: Transport<P>;
  readonly clock: Clock;
  readonly random: Random;
  readonly config?: Partial<OutboxConfig>;
}

export interface Outbox<P, Tx = unknown> {
  /** Stores an operation durably; it goes out on a later drain. */
  enqueue(operation: NewOperation<P>, tx?: Tx): Promise<OutboxEntry<P>>;
  /** Sends what is pending, batch after batch, unless backing off or the circuit is open. */
  drain(): Promise<DrainReport>;
  /** Puts back entries a crash left in `sending`. Call once when the app starts. */
  recover(): Promise<number>;
  status(): Promise<OutboxStatus>;
}

function validated(config: OutboxConfig): OutboxConfig {
  const positive = (name: keyof OutboxConfig) => {
    const value = config[name];
    if (!Number.isInteger(value) || value < 1) {
      throw new RangeError(`${name} must be a positive integer, got ${value}`);
    }
  };
  for (const name of Object.keys(config) as (keyof OutboxConfig)[]) positive(name);
  if (config.batchSize > 100)
    throw new RangeError(`batchSize is at most 100, got ${config.batchSize}`);
  if (config.backoffMaxMs < config.backoffBaseMs) {
    throw new RangeError("backoffMaxMs must not be below backoffBaseMs");
  }
  return config;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createOutbox<P, Tx = unknown>(deps: OutboxDeps<P, Tx>): Outbox<P, Tx> {
  const { store, transport, clock, random } = deps;
  const config = validated({ ...DEFAULT_CONFIG, ...deps.config });

  let draining = false;
  let consecutiveFailures = 0;
  let circuit: CircuitState = "closed";
  let nextAttemptAt: number | null = null;
  let lastSuccessAt: number | null = null;
  let lastFailureAt: number | null = null;
  let lastError: string | null = null;

  function onSuccess(now: number): void {
    consecutiveFailures = 0;
    circuit = "closed";
    nextAttemptAt = null;
    lastSuccessAt = now;
  }

  function onFailure(now: number, error: string): void {
    consecutiveFailures += 1;
    lastFailureAt = now;
    lastError = error;
    if (circuit === "half_open" || consecutiveFailures >= config.breakerThreshold) {
      circuit = "open";
      nextAttemptAt = now + config.breakerCooldownMs;
      return;
    }
    // Equal jitter: half the delay is fixed, half random, so it is never zero and devices
    // that failed together spread out.
    const delay = Math.min(
      config.backoffMaxMs,
      config.backoffBaseMs * 2 ** (consecutiveFailures - 1),
    );
    nextAttemptAt = now + Math.ceil(delay / 2 + random.next() * (delay / 2));
  }

  /** Applies one batch's results. Returns how many were acked and quarantined. */
  async function settle(
    batch: readonly OutboxEntry<P>[],
    results: readonly ItemResult[],
  ): Promise<{ acked: number; quarantined: number }> {
    const byId = new Map(results.map((result) => [result.id, result]));
    const acked: string[] = [];
    const missing: string[] = [];
    let quarantined = 0;
    for (const entry of batch) {
      const result = byId.get(entry.id);
      if (result === undefined) {
        missing.push(entry.id);
      } else if (result.status === "rejected") {
        // A design alarm, not a normal path: every queued operation is meant to be
        // impossible to reject (8.5). A person reviews it; it is never dropped.
        await store.markQuarantined(entry.id, result.error ?? "rejected by the server");
        quarantined += 1;
      } else {
        acked.push(entry.id);
      }
    }
    if (acked.length > 0) await store.markAcked(acked);
    if (missing.length > 0) await store.markRetry(missing, "no result for this operation");
    return { acked: acked.length, quarantined };
  }

  async function drainUnguarded(): Promise<DrainReport> {
    const start = clock.now();
    if (nextAttemptAt !== null && start < nextAttemptAt) {
      return { kind: "waiting", until: nextAttemptAt, circuit };
    }
    if (circuit === "open") circuit = "half_open";

    let sent = 0;
    let acked = 0;
    let quarantined = 0;
    for (;;) {
      const limit = circuit === "half_open" ? 1 : config.batchSize;
      const batch = await store.pending(limit);
      if (batch.length === 0) return { kind: "drained", sent, acked, quarantined };

      const ids = batch.map((entry) => entry.id);
      await store.markSending(ids);
      let results: readonly ItemResult[];
      try {
        results = await transport.send(batch, { timeoutMs: config.timeoutMs });
      } catch (error) {
        const reason = message(error);
        await store.markRetry(ids, reason);
        onFailure(clock.now(), reason);
        return { kind: "failed", sent, acked, error: reason };
      }
      const settled = await settle(batch, results);
      sent += batch.length;
      acked += settled.acked;
      quarantined += settled.quarantined;
      // A batch that got results for none of its operations would loop forever.
      if (settled.acked + settled.quarantined === 0) {
        const reason = "the server returned no result for the batch";
        onFailure(clock.now(), reason);
        return { kind: "failed", sent, acked, error: reason };
      }
      onSuccess(clock.now());
    }
  }

  return {
    enqueue: (operation, tx) => store.append(operation, tx),

    async drain() {
      if (draining) return { kind: "busy" };
      draining = true;
      try {
        return await drainUnguarded();
      } finally {
        draining = false;
      }
    },

    recover: () => store.resetSending(),

    async status() {
      const counts = await store.counts();
      const now = clock.now();
      return {
        ...counts,
        circuit,
        consecutiveFailures,
        nextAttemptAt: nextAttemptAt !== null && nextAttemptAt > now ? nextAttemptAt : null,
        lastSuccessAt,
        lastFailureAt,
        lastError,
      };
    },
  };
}
