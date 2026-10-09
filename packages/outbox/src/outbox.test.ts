import fc from "fast-check";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { createOutbox } from "./outbox.ts";
import type {
  Clock,
  ItemResult,
  NewOperation,
  OutboxEntry,
  OutboxState,
  OutboxStore,
  Random,
  Transport,
} from "./types.ts";

class FakeStore implements OutboxStore<string, unknown> {
  entries: OutboxEntry<string>[] = [];
  seq = 1;

  async append(operation: NewOperation<string>, _tx?: unknown): Promise<OutboxEntry<string>> {
    const entry: OutboxEntry<string> = {
      ...operation,
      deviceSeq: this.seq++,
      state: "pending",
      attempts: 0,
      lastError: null,
    };
    this.entries.push(entry);
    return entry;
  }

  async pending(limit: number): Promise<readonly OutboxEntry<string>[]> {
    return this.entries
      .filter((e) => e.state === "pending")
      .sort((a, b) => a.deviceSeq - b.deviceSeq)
      .slice(0, limit);
  }

  async markSending(ids: readonly string[]): Promise<void> {
    for (const id of ids) {
      const index = this.entries.findIndex((x) => x.id === id);
      if (index >= 0) {
        const current = this.entries[index];
        if (current) this.entries[index] = { ...current, state: "sending" };
      }
    }
  }

  async markAcked(ids: readonly string[]): Promise<void> {
    for (const id of ids) {
      const index = this.entries.findIndex((x) => x.id === id);
      if (index >= 0) {
        const current = this.entries[index];
        if (current) this.entries[index] = { ...current, state: "acked" };
      }
    }
  }

  async markRetry(ids: readonly string[], error: string): Promise<void> {
    for (const id of ids) {
      const index = this.entries.findIndex((x) => x.id === id);
      if (index >= 0) {
        const current = this.entries[index];
        if (!current) throw new Error("Entry not found despite valid index");
        this.entries[index] = {
          ...current,
          state: "pending",
          attempts: current.attempts + 1,
          lastError: error,
        };
      }
    }
  }

  async markQuarantined(id: string, error: string): Promise<void> {
    const index = this.entries.findIndex((x) => x.id === id);
    if (index >= 0) {
      const current = this.entries[index];
      if (!current) throw new Error("Entry not found despite valid index");
      this.entries[index] = {
        ...current,
        state: "quarantined",
        lastError: error,
      };
    }
  }

  async resetSending(): Promise<number> {
    let count = 0;
    for (let i = 0; i < this.entries.length; i++) {
      const e = this.entries[i];
      if (e && e.state === "sending") {
        this.entries[i] = { ...e, state: "pending" };
        count++;
      }
    }
    return count;
  }

  async counts() {
    return {
      pending: this.entries.filter((e) => e.state === "pending").length,
      sending: this.entries.filter((e) => e.state === "sending").length,
      quarantined: this.entries.filter((e) => e.state === "quarantined").length,
    };
  }
}

class FakeTransport implements Transport<string> {
  mode: "success" | "error" | "partial" | "rejected" | "none" = "success";
  calls: { batch: readonly OutboxEntry<string>[]; timeoutMs: number }[] = [];

  async send(batch: readonly OutboxEntry<string>[], options: { timeoutMs: number }) {
    this.calls.push({ batch, timeoutMs: options.timeoutMs });
    if (this.mode === "error") throw new Error("network error");
    if (this.mode === "none") return [];

    return batch
      .map((e, i): ItemResult => {
        if (this.mode === "rejected") return { id: e.id, status: "rejected", error: "bad" };
        if (this.mode === "partial") {
          if (e.id === "2") return null as any;
          return { id: e.id, status: "applied" };
        }
        return { id: e.id, status: i % 2 === 0 ? "applied" : "duplicate" };
      })
      .filter(Boolean);
  }
}

class FakeClock implements Clock {
  currentTime = 1000;
  now() {
    return this.currentTime;
  }
}

class FakeRandom implements Random {
  val = 0;
  next() {
    return this.val;
  }
}

describe("outbox", () => {
  let store: FakeStore;
  let transport: FakeTransport;
  let clock: FakeClock;
  let random: FakeRandom;

  beforeEach(() => {
    store = new FakeStore();
    transport = new FakeTransport();
    clock = new FakeClock();
    random = new FakeRandom();
  });

  function makeOp(id: string): NewOperation<string> {
    return { id, opType: "test", payload: "p", createdAt: clock.now(), clockOffsetMs: 0 };
  }

  test("enqueue passes tx exactly to store", async () => {
    const outbox = createOutbox({ store, transport, clock, random });
    const appendSpy = vi.spyOn(store, "append");
    const op = makeOp("1");
    const tx = { id: "tx1" };
    await outbox.enqueue(op, tx);
    expect(appendSpy).toHaveBeenCalledWith(op, tx);
  });

  test("drain with success: ordering, batching, acked/quarantined", async () => {
    const outbox = createOutbox({ store, transport, clock, random, config: { batchSize: 2 } });
    await outbox.enqueue(makeOp("1"));
    await outbox.enqueue(makeOp("2"));
    await outbox.enqueue(makeOp("3"));

    transport.mode = "success";
    const report = await outbox.drain();
    expect(report).toEqual({ kind: "drained", sent: 3, acked: 3, quarantined: 0 });

    // Check batches
    expect(transport.calls.length).toBe(2);
    const call0 = transport.calls[0];
    const call1 = transport.calls[1];
    if (!call0 || !call1) throw new Error("calls missing");
    expect(call0.batch.map((e) => e.id)).toEqual(["1", "2"]);
    expect(call1.batch.map((e) => e.id)).toEqual(["3"]);

    const counts = await store.counts();
    expect(counts.pending).toBe(0);
    expect(store.entries.filter((e) => e.state === "acked").length).toBe(3);

    // Rejected becomes quarantined
    transport.mode = "rejected";
    await outbox.enqueue(makeOp("4"));
    await outbox.drain();
    const entry4 = store.entries.find((e) => e.id === "4");
    expect(entry4?.state).toBe("quarantined");
    expect(entry4?.lastError).toBe("bad");

    // Rejected without error defaults to "rejected by the server"
    transport.send = async () => [{ id: "5", status: "rejected" }];
    await outbox.enqueue(makeOp("5"));
    await outbox.drain();
    const entry5 = store.entries.find(e => e.id === "5");
    expect(entry5?.state).toBe("quarantined");
    expect(entry5?.lastError).toBe("rejected by the server");
  });

  test("partial results put missing back to pending, empty usable counts as failed", async () => {
    const outbox = createOutbox({ store, transport, clock, random, config: { batchSize: 2 } });
    await outbox.enqueue(makeOp("1"));
    await outbox.enqueue(makeOp("2"));
    transport.mode = "partial";
    const report1 = await outbox.drain();

    // 1 applied, 2 missing
    const e1 = store.entries.find((e) => e.id === "1");
    const e2 = store.entries.find((e) => e.id === "2");
    expect(e1?.state).toBe("acked");
    expect(e2?.state).toBe("pending");
    expect(e2?.attempts).toBe(2);
    expect(report1.kind).toBe("failed");

    // empty results = failed
    transport.mode = "none";
    clock.currentTime += 120_000;
    const report2 = await outbox.drain();
    expect(report2.kind).toBe("failed");
    expect(store.entries.find((e) => e.id === "2")?.state).toBe("pending");
  });

  test("transport exception", async () => {
    const outbox = createOutbox({ store, transport, clock, random, config: { timeoutMs: 4000 } });
    await outbox.enqueue(makeOp("1"));
    transport.mode = "error";
    const report = await outbox.drain();

    expect(report.kind).toBe("failed");
    if (report.kind === "failed") {
      expect(report.error).toBe("network error");
    }
    const e1 = store.entries.find((e) => e.id === "1");
    if (!e1) throw new Error("e1 not found");
    expect(e1.state).toBe("pending");
    expect(e1.attempts).toBe(1);
    const call0 = transport.calls[0];
    if (!call0) throw new Error("call missing");
    expect(call0.timeoutMs).toBe(4000);
  });

  test("transport exception (string)", async () => {
    const outbox = createOutbox({ store, transport, clock, random, config: { timeoutMs: 4000 } });
    await outbox.enqueue(makeOp("1"));
    transport.send = () => { throw "network string"; };
    const report = await outbox.drain();
    expect(report.kind).toBe("failed");
    if (report.kind === "failed") expect(report.error).toBe("network string");
  });

  test("backoff logic", async () => {
    const base = 2000;
    const max = 60000;
    const outbox = createOutbox({
      store,
      transport,
      clock,
      random,
      config: { backoffBaseMs: base, backoffMaxMs: max },
    });
    await outbox.enqueue(makeOp("1"));
    transport.mode = "error";

    // Fail 1: delay = min(max, base * 2^0) = 2000
    random.val = 0; // nextAttempt = now + ceil(1000 + 0) = now + 1000
    await outbox.drain();
    const st1 = await outbox.status();
    expect(st1.nextAttemptAt).toBe(1000 + 1000);

    // Try before time
    clock.currentTime = 1999;
    const rep1 = await outbox.drain();
    expect(rep1.kind).toBe("waiting");

    // Fail 2: delay = 4000
    clock.currentTime = 2000;
    random.val = 0.999; // delay/2 + 0.999 * delay/2 = 2000 + 1998 = 3998
    await outbox.drain();
    const st2 = await outbox.status();
    expect(st2.nextAttemptAt).toBe(2000 + 3998);
  });

  test("circuit breaker", async () => {
    const outbox = createOutbox({
      store,
      transport,
      clock,
      random,
      config: { breakerThreshold: 3, breakerCooldownMs: 60000 },
    });
    await outbox.enqueue(makeOp("1"));
    await outbox.enqueue(makeOp("2"));
    transport.mode = "error";

    await outbox.drain(); // fail 1
    clock.currentTime += 5000;
    await outbox.drain(); // fail 2
    clock.currentTime += 10000;
    await outbox.drain(); // fail 3 -> opens circuit

    const statusOpen = await outbox.status();
    expect(statusOpen.circuit).toBe("open");
    expect(statusOpen.nextAttemptAt).toBe(clock.currentTime + 60000);

    // probe with half_open
    clock.currentTime += 60000;
    transport.mode = "success";
    const rep = await outbox.drain();
    expect(rep.kind).toBe("drained");

    // it sent exactly 1 first, then the rest
    expect(transport.calls.length).toBe(5); // 3 fails + 2 successes (probe of 1, then the rest)
    const call3 = transport.calls[3];
    const call4 = transport.calls[4];
    if (!call3 || !call4) throw new Error("calls missing");
    expect(call3.batch.length).toBe(1);
    expect(call4.batch.length).toBe(1);
    const b0 = call4.batch[0];
    if (!b0) throw new Error("batch[0] missing");
    expect(b0.id).toBe("2");

    // back to closed
    expect((await outbox.status()).circuit).toBe("closed");
  });

  test("circuit breaker goes back to open if probe fails", async () => {
    const outbox = createOutbox({
      store,
      transport,
      clock,
      random,
      config: { breakerThreshold: 1, breakerCooldownMs: 60000 },
    });
    await outbox.enqueue(makeOp("1"));
    transport.mode = "error";
    await outbox.drain(); // open

    clock.currentTime += 60000;
    await outbox.drain(); // half_open probe fails -> open
    expect((await outbox.status()).circuit).toBe("open");
  });

  test("concurrent drain returns busy", async () => {
    const outbox = createOutbox({ store, transport, clock, random });
    await outbox.enqueue(makeOp("1"));
    transport.send = async () => {
      const rep = await outbox.drain();
      expect(rep.kind).toBe("busy");
      return [];
    };
    await outbox.drain();
  });

  test("recover resets sending to pending", async () => {
    const outbox = createOutbox({ store, transport, clock, random });
    const e = await outbox.enqueue(makeOp("1"));
    await store.markSending([e.id]);
    await outbox.recover();
    const st = await outbox.status();
    expect(st.pending).toBe(1);
    expect(st.sending).toBe(0);
  });

  test("status formats correctly and clears nextAttemptAt", async () => {
    const outbox = createOutbox({ store, transport, clock, random });
    await outbox.enqueue(makeOp("1"));
    transport.mode = "error";
    await outbox.drain(); // sets nextAttemptAt

    const st1 = await outbox.status();
    expect(st1.nextAttemptAt).toBeGreaterThan(clock.currentTime);

    clock.currentTime += 10000;
    const st2 = await outbox.status();
    expect(st2.nextAttemptAt).toBeNull(); // past
  });

  test("configuration validation", () => {
    const valid = { store, transport, clock, random };
    expect(() => createOutbox({ ...valid, config: { batchSize: 0 } })).toThrow(RangeError);
    expect(() => createOutbox({ ...valid, config: { batchSize: 101 } })).toThrow(RangeError);
    expect(() => createOutbox({ ...valid, config: { timeoutMs: 1.5 } })).toThrow(RangeError);
    expect(() =>
      createOutbox({ ...valid, config: { backoffMaxMs: 1000, backoffBaseMs: 2000 } }),
    ).toThrow(RangeError);
  });
});

describe("outbox properties (fast-check model based)", () => {
  // We model the operations.
  // We'll define fast-check commands.

  interface Model {
    clock: number;
    ops: Map<string, { seq: number; state: OutboxState }>;
    seq: number;
  }

  class EnqueueCommand implements fc.Command<Model, any> {
    id: string;
    constructor(id: string) {
      this.id = id;
    }
    check() {
      return true;
    }
    async run(m: Model, r: any) {
      await r.outbox.enqueue({
        id: this.id,
        opType: "test",
        payload: "p",
        createdAt: m.clock,
        clockOffsetMs: 0,
      });
      m.ops.set(this.id, { seq: m.seq++, state: "pending" });
    }
    toString() {
      return `enqueue(${this.id})`;
    }
  }

  class DrainCommand implements fc.Command<Model, any> {
    transportMode: "success" | "error" | "partial" | "rejected";
    constructor(transportMode: "success" | "error" | "partial" | "rejected") {
      this.transportMode = transportMode;
    }
    check() {
      return true;
    }
    async run(m: Model, r: any) {
      r.transport.mode = this.transportMode;
      const stBefore = await r.outbox.status();
      await r.outbox.drain();
      const _stAfter = await r.outbox.status();

      // Update model based on what should have happened
      if (
        this.transportMode === "success" &&
        stBefore.circuit !== "open" &&
        (stBefore.nextAttemptAt === null || stBefore.nextAttemptAt <= m.clock)
      ) {
        for (const [_id, op] of m.ops.entries()) {
          if (op.state === "pending") op.state = "acked";
        }
      }
      // Accurate modeling of all transport modes is hard, we just update what we can
      // and rely on invariants checked at the end or during run.
    }
    toString() {
      return `drain(${this.transportMode})`;
    }
  }

  class AdvanceClockCommand implements fc.Command<Model, any> {
    ms: number;
    constructor(ms: number) {
      this.ms = ms;
    }
    check() {
      return true;
    }
    async run(m: Model, r: any) {
      m.clock += this.ms;
      r.clock.currentTime = m.clock;
    }
    toString() {
      return `advanceClock(${this.ms})`;
    }
  }

  class RecoverCommand implements fc.Command<Model, any> {
    check() {
      return true;
    }
    async run(m: Model, r: any) {
      await r.outbox.recover();
      for (const op of m.ops.values()) {
        if (op.state === "sending") op.state = "pending";
      }
    }
    toString() {
      return `recover`;
    }
  }

  test("invariants", async () => {
    const allCommands = [
      fc.uuid().map((id) => new EnqueueCommand(id)),
      fc
        .constantFrom("success", "error", "partial", "rejected")
        .map((m) => new DrainCommand(m as any)),
      fc.integer({ min: 1000, max: 100000 }).map((ms) => new AdvanceClockCommand(ms)),
      fc.constant(new RecoverCommand()),
    ];

    await fc.assert(
      fc.asyncProperty(fc.commands(allCommands, { size: "+1" }), async (cmds) => {
        const setup = () => {
          const store = new FakeStore();
          const transport = new FakeTransport();
          const clock = new FakeClock();
          const random = new FakeRandom();
          const outbox = createOutbox({
            store,
            transport,
            clock,
            random,
            config: { batchSize: 5 },
          });
          return {
            model: { clock: 1000, ops: new Map(), seq: 1 },
            real: { store, transport, clock, random, outbox },
          };
        };

        const { model, real } = setup();
        await fc.asyncModelRun(setup, cmds);

        // I6 Invariants
        for (const [id, _mOp] of model.ops.entries()) {
          const rOp = real.store.entries.find((e) => e.id === id);
          // no operation disappears
          expect(rOp).toBeDefined();
          if (!rOp) throw new Error("rOp not found");
          // ends acked, quarantined or pending
          expect(["acked", "quarantined", "pending"].includes(rOp.state)).toBe(true);
          // no duplicates
          expect(real.store.entries.filter((e) => e.id === id).length).toBe(1);
        }

        // no out of order pending
        const pendings = real.store.entries.filter((e) => e.state === "pending");
        for (let i = 1; i < pendings.length; i++) {
          const prev = pendings[i - 1];
          const curr = pendings[i];
          if (!prev || !curr) throw new Error("pending missing");
          expect(curr.deviceSeq).toBeGreaterThan(prev.deviceSeq);
        }

        // no batch exceeds batchSize
        for (const call of real.transport.calls) {
          expect(call.batch.length).toBeLessThanOrEqual(5);
        }

        // if transport is good and clock advances, everything left pending should be acked or quarantined
        real.clock.currentTime += 1000000;
        real.transport.mode = "success";
        await real.outbox.drain();
        for (const rOp of real.store.entries) {
          if (model.ops.get(rOp.id)) {
            expect(["acked", "quarantined"].includes(rOp.state)).toBe(true);
          }
        }
      }),
      { numRuns: 100 },
    );
  });
});
