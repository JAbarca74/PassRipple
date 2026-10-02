// Everything a gate device does for one enrolled event: download and update the manifest,
// decide each scan locally, record admissions durably, drain the queue, and wipe the
// event's data when it is over (design 4.4, 8). It never waits for the network to answer
// the operator: the green screen comes from the phone alone.

import type { DB, Transaction } from "@op-engineering/op-sqlite";
import type {
  DeviceStatus,
  GateDevice,
  GateOperation,
  IncidentPayload,
} from "@passripple/contracts";
import { normalizeHumanCode } from "@passripple/crypto";
import { createOutbox, type Outbox, type OutboxStatus, type Transport } from "@passripple/outbox";
import { type Api, ApiFailure } from "./api.ts";
import type { ClockSnapshot, DeviceClock } from "./clock.ts";
import { deleteEventDb, getSetting, openEventDb, setSetting } from "./db.ts";
import { ManifestStore, type StoredTicket } from "./manifest-store.ts";
import { createOutboxStore, type GatePayload } from "./outbox-store.ts";
import { newOperationId, secureRandom } from "./random.ts";
import { type Burst, ManualEntryLimiter, ScanSession } from "./scan-session.ts";
import { eventDbKey, forgetEnrollment, saveEnrollment } from "./secure.ts";
import { checkManifest, decideQr, type GateDecision } from "./verify.ts";

/** Timeout of every call made while syncing (design 8.8). */
export const SYNC_TIMEOUT_MS = 4_000;

export interface ScanOutcome {
  readonly decision: GateDecision;
  readonly burst: Burst | null;
}

export type ManualLookup =
  | { readonly kind: "found"; readonly ticket: StoredTicket; readonly decision: GateDecision }
  | { readonly kind: "invalid_code" | "not_found"; readonly lockedForMs: number }
  | { readonly kind: "locked"; readonly lockedForMs: number };

export interface GateStatus {
  readonly outbox: OutboxStatus;
  readonly device: GateDevice;
  readonly eventName: string | null;
  readonly expiresAt: string | null;
  readonly lastManifestAt: number | null;
  readonly lastSyncAt: number | null;
  readonly clockOffsetMs: number;
  readonly clockSynced: boolean;
  readonly tickets: number;
  readonly admitted: number;
  /** The event's window or the device's validity is over, by the corrected clock. */
  readonly over: boolean;
}

export class GateSession {
  readonly device: GateDevice;
  readonly manifest: ManifestStore;
  readonly outbox: Outbox<GatePayload, Transaction>;
  private readonly db: DB;
  private readonly api: Api;
  private readonly token: string;
  private readonly clock: DeviceClock;
  private readonly scans = new ScanSession();
  private readonly manual = new ManualEntryLimiter();
  private deviceState: GateDevice;

  private constructor(db: DB, device: GateDevice, token: string, api: Api, clock: DeviceClock) {
    this.db = db;
    this.device = device;
    this.deviceState = device;
    this.token = token;
    this.api = api;
    this.clock = clock;
    this.manifest = new ManifestStore(db);
    const transport: Transport<GatePayload> = {
      send: async (batch, { timeoutMs }) => {
        const items = batch.map(
          (entry) =>
            ({
              id: entry.id,
              deviceSeq: entry.deviceSeq,
              opType: entry.opType,
              createdAt: entry.createdAt,
              clockOffsetMs: entry.clockOffsetMs,
              payload: entry.payload,
            }) as GateOperation,
        );
        const results = await this.api.uploadBatch(this.token, items, timeoutMs);
        await setSetting(this.db, "last_sync_at", String(Date.now()));
        return results;
      },
    };
    this.outbox = createOutbox({
      store: createOutboxStore(db),
      transport,
      clock: { now: () => Date.now() },
      random: secureRandom,
    });
  }

  /** Opens the event's encrypted database and puts back what a crash left half-sent. */
  static async open(
    device: GateDevice,
    token: string,
    api: Api,
    clock: DeviceClock,
  ): Promise<GateSession> {
    const db = await openEventDb(device.deviceId, await eventDbKey(device.deviceId));
    const session = new GateSession(db, device, token, api, clock);
    await session.outbox.recover();
    return session;
  }

  /** The clock correction saved with this event, to start corrected after a restart. */
  static async storedClock(session: GateSession): Promise<ClockSnapshot | null> {
    const text = await getSetting(session.db, "clock");
    return text === null ? null : (JSON.parse(text) as ClockSnapshot);
  }

  get currentDevice(): GateDevice {
    return this.deviceState;
  }

  async saveClock(): Promise<void> {
    const snapshot = this.clock.snapshot();
    if (snapshot !== null) await setSetting(this.db, "clock", JSON.stringify(snapshot));
  }

  async hasManifest(): Promise<boolean> {
    return (await this.manifest.info()) !== null;
  }

  /** Downloads the whole manifest. Done with signal, before the event (8.2). */
  async downloadManifest(): Promise<void> {
    const manifest = await this.api.manifest(this.token);
    if (manifest.eventId !== this.device.eventId)
      throw new Error("the manifest is for another event");
    await this.manifest.applyManifest(manifest);
    await this.saveClock();
  }

  /** Fetches what changed since the last update. Returns false if there was no signal. */
  async refreshManifest(): Promise<boolean> {
    const info = await this.manifest.info();
    if (info === null || this.deviceState.status !== "active") return false;
    try {
      await this.manifest.applyDelta(
        await this.api.manifestDelta(this.token, info.cursor, SYNC_TIMEOUT_MS * 2),
      );
      await this.saveClock();
      return true;
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 403) await this.checkSession();
      return false;
    }
  }

  /** Asks the server for this device's status: revocation reaches the phone here. */
  async checkSession(): Promise<DeviceStatus | null> {
    try {
      const { device } = await this.api.gateSession(this.token, SYNC_TIMEOUT_MS);
      this.deviceState = device;
      await saveEnrollment(device);
      return device.status;
    } catch {
      return null;
    }
  }

  async drain() {
    const report = await this.outbox.drain();
    if (report.kind === "drained" && report.sent > 0) await this.saveClock();
    return report;
  }

  private async record(
    decision: Extract<GateDecision, { kind: "admit" }>,
    method: "qr" | "manual",
    idChecked: boolean,
  ): Promise<void> {
    const createdAt = Date.now();
    await this.db.transaction(async (tx) => {
      if (decision.entryMode === "single_use") {
        if (decision.inManifest) await this.manifest.markAdmitted(tx, decision.ticketId);
        else await this.manifest.claimOutsideManifest(tx, decision);
      }
      await this.outbox.enqueue(
        {
          id: newOperationId(createdAt),
          opType: decision.entryMode === "multi_scan" ? "staff_scan" : "redemption",
          payload: {
            ticketId: decision.ticketId,
            method,
            idChecked,
            inManifest: decision.inManifest,
          },
          createdAt,
          clockOffsetMs: this.clock.offsetMs(),
        },
        tx,
      );
    });
  }

  private async lookups() {
    return {
      serverKeys: await this.manifest.serverKeys(),
      eventId: this.device.eventId,
      ticketTypes: await this.manifest.ticketTypes(),
      ticket: (id: string) => this.manifest.ticket(id),
    };
  }

  /**
   * A read from the camera. Returns null for the camera seeing the same code again. An
   * admission is stored and queued before this returns.
   */
  async scanQr(text: string): Promise<ScanOutcome | null> {
    const now = Date.now();
    if (!this.scans.isNewRead(text, now)) return null;
    if (!(await this.canValidate())) {
      return {
        decision: { kind: "reject", reason: "gate_closed", ticketId: null, typeName: null },
        burst: null,
      };
    }
    const decision = await decideQr(text, await this.lookups(), this.clock.now());
    if (decision.kind !== "admit") return { decision, burst: null };
    await this.record(decision, "qr", false);
    const total =
      decision.holderPubkey === null
        ? 1
        : await this.manifest.holderTicketCount(decision.holderPubkey);
    return {
      decision,
      burst: this.scans.admitted(decision.ticketId, decision.holderPubkey, total, now),
    };
  }

  /** Looks a typed code up, counting failures toward the lock (6.7). */
  async findByCode(typed: string): Promise<ManualLookup> {
    const now = Date.now();
    if (!(await this.canValidate())) return { kind: "locked", lockedForMs: 0 };
    const locked = this.manual.lockedFor(now);
    if (locked > 0) return { kind: "locked", lockedForMs: locked };
    const code = normalizeHumanCode(typed);
    const ticket = code === null ? null : await this.manifest.ticketByCode(code);
    if (ticket === null) {
      if (this.manual.fail(now))
        await this.reportIncident({ kind: "manual_entry_locked", ticketId: null, note: null });
      return {
        kind: code === null ? "invalid_code" : "not_found",
        lockedForMs: this.manual.lockedFor(now),
      };
    }
    this.manual.succeed();
    const type = (await this.manifest.ticketTypes()).get(ticket.typeRef);
    return {
      kind: "found",
      ticket,
      decision: checkManifest(ticket, type?.name ?? "Entrada", null),
    };
  }

  /** Admits a ticket found by its code, once the operator confirmed it. */
  async admitManual(ticket: StoredTicket, idChecked: boolean): Promise<GateDecision> {
    if (!(await this.canValidate())) {
      return { kind: "reject", reason: "gate_closed", ticketId: ticket.ticketId, typeName: null };
    }
    const type = (await this.manifest.ticketTypes()).get(ticket.typeRef);
    // Read again: the same code may have been admitted while the operator was confirming.
    const fresh = (await this.manifest.ticket(ticket.ticketId)) ?? ticket;
    const decision = checkManifest(fresh, type?.name ?? "Entrada", null);
    if (decision.kind === "admit") await this.record(decision, "manual", idChecked);
    return decision;
  }

  async reportIncident(payload: IncidentPayload): Promise<void> {
    const createdAt = Date.now();
    await this.outbox.enqueue({
      id: newOperationId(createdAt),
      opType: "incident",
      payload,
      createdAt,
      clockOffsetMs: this.clock.offsetMs(),
    });
  }

  /** Whether the event's window and the device's validity are still open. */
  isOver(expiresAt: string | null): boolean {
    const now = this.clock.now();
    return (
      (expiresAt !== null && now >= Date.parse(expiresAt)) ||
      now >= Date.parse(this.deviceState.validUntil) ||
      this.deviceState.status !== "active"
    );
  }

  /** Whether this phone may still admit people: active, inside its window and the event's. */
  async canValidate(): Promise<boolean> {
    return !this.isOver((await this.manifest.info())?.expiresAt ?? null);
  }

  async status(): Promise<GateStatus> {
    const [outbox, info, counts, lastSync] = await Promise.all([
      this.outbox.status(),
      this.manifest.info(),
      this.manifest.counts(),
      getSetting(this.db, "last_sync_at"),
    ]);
    return {
      outbox,
      device: this.deviceState,
      eventName: info?.event.name ?? null,
      expiresAt: info?.expiresAt ?? null,
      lastManifestAt: info?.updatedAt ?? null,
      lastSyncAt: lastSync === null ? null : Number(lastSync),
      clockOffsetMs: this.clock.offsetMs(),
      clockSynced: this.clock.isSynced(),
      tickets: counts.tickets,
      admitted: counts.admitted,
      over: this.isOver(info?.expiresAt ?? null),
    };
  }

  /** Nothing waits to be uploaded: no pending, sending or quarantined operation (8.9). */
  async isQueueEmpty(): Promise<boolean> {
    const counts = await this.outbox.status();
    return counts.pending + counts.sending + counts.quarantined === 0;
  }

  /** Signs the device out on the server. Refuses while anything waits to be uploaded. */
  async signOut(): Promise<void> {
    if (!(await this.isQueueEmpty())) throw new Error("pending operations");
    await this.api.signOutDevice(this.token);
    await this.wipe();
  }

  /** Deletes the event's data from the phone. Only with an empty queue (8.3, 8.9). */
  async wipe(): Promise<void> {
    if (!(await this.isQueueEmpty())) throw new Error("pending operations");
    deleteEventDb(this.db);
    await forgetEnrollment(this.device.deviceId);
  }
}
