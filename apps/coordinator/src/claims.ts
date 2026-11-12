// The claims of one zone's gates (design 8.2): which ticket was admitted first, and by which
// device. A single-use ticket has one winner; asking again from the same device answers the
// same, so a retried request after a dropped Wi-Fi packet is harmless.

export type ClaimResult =
  | { readonly status: "granted"; readonly deviceId: string; readonly claimedAt: number }
  | { readonly status: "already"; readonly deviceId: string; readonly claimedAt: number };

export interface ClaimStore {
  /** Records the claim if the ticket has none; otherwise reports who holds it. Atomic. */
  claim(ticketId: string, deviceId: string, nowMs: number): ClaimResult;
  count(): number;
}

export class MemoryClaimStore implements ClaimStore {
  readonly #claims = new Map<string, { deviceId: string; claimedAt: number }>();

  claim(ticketId: string, deviceId: string, nowMs: number): ClaimResult {
    const held = this.#claims.get(ticketId);
    if (!held) {
      this.#claims.set(ticketId, { deviceId, claimedAt: nowMs });
      return { status: "granted", deviceId, claimedAt: nowMs };
    }
    return { status: held.deviceId === deviceId ? "granted" : "already", ...held };
  }

  count(): number {
    return this.#claims.size;
  }
}

/** The part of a SQLite statement the store uses: node:sqlite and bun:sqlite both fit. */
export interface SqliteStatement {
  run(...params: (string | number)[]): unknown;
  get(...params: (string | number)[]): unknown;
}

export interface SqliteDatabase {
  exec(sql: string): unknown;
  prepare(sql: string): SqliteStatement;
}

interface ClaimRow {
  device_id: string;
  claimed_at: number;
}

/** Claims in SQLite with full synchronous writes, so a power cut never loses an admission. */
export class SqliteClaimStore implements ClaimStore {
  readonly #insert: SqliteStatement;
  readonly #select: SqliteStatement;
  readonly #count: SqliteStatement;

  constructor(db: SqliteDatabase) {
    db.exec("PRAGMA synchronous = FULL");
    db.exec(
      "CREATE TABLE IF NOT EXISTS claims (ticket_id TEXT PRIMARY KEY, device_id TEXT NOT NULL, claimed_at INTEGER NOT NULL) STRICT",
    );
    this.#insert = db.prepare(
      "INSERT OR IGNORE INTO claims (ticket_id, device_id, claimed_at) VALUES (?, ?, ?)",
    );
    this.#select = db.prepare("SELECT device_id, claimed_at FROM claims WHERE ticket_id = ?");
    this.#count = db.prepare("SELECT count(*) AS n FROM claims");
  }

  claim(ticketId: string, deviceId: string, nowMs: number): ClaimResult {
    this.#insert.run(ticketId, deviceId, nowMs);
    const row = this.#select.get(ticketId) as ClaimRow;
    return {
      status: row.device_id === deviceId ? "granted" : "already",
      deviceId: row.device_id,
      claimedAt: row.claimed_at,
    };
  }

  count(): number {
    return (this.#count.get() as { n: number }).n;
  }
}
