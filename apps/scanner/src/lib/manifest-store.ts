// The manifest on the phone: what step 4 of 6.3 checks a verified credential against, and
// what manual entry looks codes up in. Applying a manifest or a delta replaces each ticket
// whole but keeps whether this device admitted it.

import type { DB, Transaction } from "@op-engineering/op-sqlite";
import type {
  GateManifest,
  GateManifestDelta,
  ManifestEvent,
  ManifestTicket,
  ManifestTicketType,
} from "@passripple/contracts";
import type { ServerKeyRing } from "@passripple/crypto";
import { blob, getSetting, setSetting } from "./db.ts";

export interface StoredTicket {
  readonly ticketId: string;
  readonly typeRef: number;
  readonly entryMode: ManifestTicket["entryMode"];
  readonly status: ManifestTicket["status"];
  /** Admitted, by the server or on this device. */
  readonly redeemed: boolean;
  readonly holderPubkey: Uint8Array | null;
  readonly keyVersion: number;
  readonly codeHuman: string;
}

export interface ManifestInfo {
  readonly eventId: string;
  readonly event: ManifestEvent;
  readonly deviceZone: string | null;
  readonly expiresAt: string;
  readonly cursor: string;
  /** Device wall time of the last manifest or delta applied. */
  readonly updatedAt: number;
}

const UPSERT_TICKET = `
  INSERT INTO tickets (ticket_id, type_ref, entry_mode, status, redeemed_server, holder_pubkey,
                       key_version, code_human)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (ticket_id) DO UPDATE SET
    type_ref = excluded.type_ref, entry_mode = excluded.entry_mode, status = excluded.status,
    redeemed_server = excluded.redeemed_server, holder_pubkey = excluded.holder_pubkey,
    key_version = excluded.key_version, code_human = excluded.code_human`;

function ticketParams(ticket: ManifestTicket) {
  return [
    ticket.ticketId,
    ticket.typeRef,
    ticket.entryMode,
    ticket.status,
    ticket.redeemed ? 1 : 0,
    ticket.holderPubkey,
    ticket.keyVersion,
    ticket.codeHuman,
  ];
}

function rowToTicket(row: Record<string, unknown>): StoredTicket {
  return {
    ticketId: String(row.ticket_id),
    typeRef: Number(row.type_ref),
    entryMode: row.entry_mode === "multi_scan" ? "multi_scan" : "single_use",
    status: row.status === "void" ? "void" : row.status === "bound" ? "bound" : "issued",
    redeemed: Number(row.redeemed_server) === 1 || Number(row.redeemed_local) === 1,
    holderPubkey: blob(row.holder_pubkey),
    keyVersion: Number(row.key_version),
    codeHuman: String(row.code_human),
  };
}

export class ManifestStore {
  private readonly db: DB;
  private keyRing: ServerKeyRing | null = null;
  private types: Map<number, ManifestTicketType> | null = null;

  constructor(db: DB) {
    this.db = db;
  }

  private async replaceRings(
    serverKeys: GateManifest["serverKeys"],
    ticketTypes: readonly ManifestTicketType[],
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.execute("DELETE FROM server_keys");
      for (const key of serverKeys) {
        await tx.execute("INSERT INTO server_keys (id, public_key) VALUES (?, ?)", [
          key.id,
          key.publicKey,
        ]);
      }
      await tx.execute("DELETE FROM ticket_types");
      for (const type of ticketTypes) {
        await tx.execute(
          "INSERT INTO ticket_types (ref, name, zone, entry_mode, audience) VALUES (?, ?, ?, ?, ?)",
          [type.ref, type.name, type.zone, type.entryMode, type.audience],
        );
      }
    });
    this.keyRing = null;
    this.types = null;
  }

  private async upsertTickets(tickets: readonly ManifestTicket[]): Promise<void> {
    // One transaction per thousand tickets keeps memory flat on large events.
    for (let start = 0; start < tickets.length; start += 1000) {
      const chunk = tickets.slice(start, start + 1000);
      await this.db.executeBatch(chunk.map((ticket) => [UPSERT_TICKET, ticketParams(ticket)]));
    }
  }

  private async saveInfo(info: Omit<ManifestInfo, "updatedAt">): Promise<void> {
    await setSetting(this.db, "manifest", JSON.stringify({ ...info, updatedAt: Date.now() }));
  }

  /** Applies a whole manifest. The cursor is saved last, so a crash halfway repeats it. */
  async applyManifest(manifest: GateManifest): Promise<void> {
    await this.replaceRings(manifest.serverKeys, manifest.ticketTypes);
    await this.upsertTickets(manifest.tickets);
    await this.saveInfo({
      eventId: manifest.eventId,
      event: manifest.event,
      deviceZone: manifest.deviceZone,
      expiresAt: manifest.expiresAt,
      cursor: manifest.cursor,
    });
  }

  /** Applies what changed since the saved cursor. */
  async applyDelta(delta: GateManifestDelta): Promise<void> {
    const info = await this.info();
    if (info === null || info.eventId !== delta.eventId)
      throw new Error("this update is for another event");
    await this.replaceRings(delta.serverKeys, delta.ticketTypes);
    await this.upsertTickets(delta.tickets);
    await this.saveInfo({ ...info, expiresAt: delta.expiresAt, cursor: delta.cursor });
  }

  async info(): Promise<ManifestInfo | null> {
    const text = await getSetting(this.db, "manifest");
    return text === null ? null : (JSON.parse(text) as ManifestInfo);
  }

  /** The server keys this device trusts. */
  async serverKeys(): Promise<ServerKeyRing> {
    if (this.keyRing === null) {
      const result = await this.db.execute("SELECT id, public_key FROM server_keys");
      const ring = new Map<number, Uint8Array>();
      for (const row of result.rows) {
        const key = blob(row.public_key);
        if (key !== null) ring.set(Number(row.id), key);
      }
      this.keyRing = ring;
    }
    return this.keyRing;
  }

  /** The event's ticket types this device admits, by ref. */
  async ticketTypes(): Promise<ReadonlyMap<number, ManifestTicketType>> {
    if (this.types === null) {
      const result = await this.db.execute(
        "SELECT ref, name, zone, entry_mode, audience FROM ticket_types",
      );
      this.types = new Map(
        result.rows.map((row) => [
          Number(row.ref),
          {
            ref: Number(row.ref),
            name: String(row.name),
            zone: row.zone === null ? null : String(row.zone),
            entryMode: row.entry_mode === "multi_scan" ? "multi_scan" : "single_use",
            audience:
              row.audience === "staff"
                ? "staff"
                : row.audience === "performer"
                  ? "performer"
                  : "public",
          } satisfies ManifestTicketType,
        ]),
      );
    }
    return this.types;
  }

  async ticket(ticketId: string): Promise<StoredTicket | null> {
    const result = await this.db.execute("SELECT * FROM tickets WHERE ticket_id = ?", [ticketId]);
    const row = result.rows[0];
    return row === undefined ? null : rowToTicket(row);
  }

  async ticketByCode(canonicalCode: string): Promise<StoredTicket | null> {
    const result = await this.db.execute("SELECT * FROM tickets WHERE code_human = ?", [
      canonicalCode,
    ]);
    const row = result.rows[0];
    return row === undefined ? null : rowToTicket(row);
  }

  /** How many usable tickets are bound to a device key: one buyer's group (6.5). */
  async holderTicketCount(holderPubkey: Uint8Array): Promise<number> {
    const result = await this.db.execute(
      "SELECT count(*) AS n FROM tickets WHERE holder_pubkey = ? AND status <> 'void'",
      [holderPubkey],
    );
    return Number(result.rows[0]?.n ?? 0);
  }

  /** Marks a ticket as admitted on this device, inside the transaction that queues it. */
  async markAdmitted(tx: Transaction, ticketId: string): Promise<void> {
    await tx.execute("UPDATE tickets SET redeemed_local = 1 WHERE ticket_id = ?", [ticketId]);
  }

  /**
   * Claims a ticket missing from the manifest, admitted on its credential alone (6.3), so
   * this device refuses it a second time. The next update brings the full row and keeps
   * the claim.
   */
  async claimOutsideManifest(
    tx: Transaction,
    ticket: {
      ticketId: string;
      typeRef: number;
      entryMode: string;
      holderPubkey: Uint8Array | null;
      keyVersion: number;
    },
  ): Promise<void> {
    await tx.execute(
      `INSERT INTO tickets (ticket_id, type_ref, entry_mode, status, redeemed_local, holder_pubkey,
                            key_version, code_human)
       VALUES (?, ?, ?, 'bound', 1, ?, ?, '')
       ON CONFLICT (ticket_id) DO UPDATE SET redeemed_local = 1`,
      [ticket.ticketId, ticket.typeRef, ticket.entryMode, ticket.holderPubkey, ticket.keyVersion],
    );
  }

  async counts(): Promise<{ readonly tickets: number; readonly admitted: number }> {
    const result = await this.db.execute(
      `SELECT count(*) AS tickets,
              sum(CASE WHEN redeemed_server = 1 OR redeemed_local = 1 THEN 1 ELSE 0 END) AS admitted
         FROM tickets WHERE status <> 'void'`,
    );
    const row = result.rows[0];
    return { tickets: Number(row?.tickets ?? 0), admitted: Number(row?.admitted ?? 0) };
  }
}
