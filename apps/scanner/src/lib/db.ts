// One encrypted SQLite database per enrolled device (design 3.3, 8.3): the manifest, the
// outbox and a few settings. SQLCipher encrypts it with a key kept in the Keychain or
// Keystore. Wiping the event deletes the file and forgets the key.
//
// The outbox lives in the same database as the manifest, so admitting a ticket locally and
// queueing its operation are one transaction (4.4, step 3). WAL with synchronous = FULL
// makes each commit durable before it returns: a forced power-off loses nothing (8.9).

import { type DB, open } from "@op-engineering/op-sqlite";

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS server_keys (id INTEGER PRIMARY KEY, public_key BLOB NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS ticket_types (
     ref INTEGER PRIMARY KEY, name TEXT NOT NULL, zone TEXT, entry_mode TEXT NOT NULL,
     audience TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS tickets (
     ticket_id TEXT PRIMARY KEY,
     type_ref INTEGER NOT NULL,
     entry_mode TEXT NOT NULL,
     status TEXT NOT NULL,
     -- Admitted, as the server last said.
     redeemed_server INTEGER NOT NULL DEFAULT 0,
     -- Admitted on this device: the local list of claimed tickets (6.5).
     redeemed_local INTEGER NOT NULL DEFAULT 0,
     holder_pubkey BLOB,
     key_version INTEGER NOT NULL,
     code_human TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS tickets_code ON tickets (code_human)`,
  `CREATE INDEX IF NOT EXISTS tickets_holder ON tickets (holder_pubkey)`,
  `CREATE TABLE IF NOT EXISTS outbox (
     id TEXT PRIMARY KEY,
     device_seq INTEGER NOT NULL UNIQUE,
     op_type TEXT NOT NULL,
     payload TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     clock_offset INTEGER NOT NULL,
     state TEXT NOT NULL DEFAULT 'pending',
     attempts INTEGER NOT NULL DEFAULT 0,
     last_error TEXT)`,
  `CREATE INDEX IF NOT EXISTS ix_outbox_drain ON outbox (device_seq) WHERE state = 'pending'`,
];

function dbName(deviceId: string): string {
  return `event-${deviceId}.sqlite`;
}

/**
 * Opens (or creates) the event database. Refuses to continue unless SQLCipher is active:
 * the manifest holds people's data and must never be written in the clear.
 */
export async function openEventDb(deviceId: string, key: string): Promise<DB> {
  const db = open({ name: dbName(deviceId), encryptionKey: key });
  const cipher = await db.execute("PRAGMA cipher_version");
  if (cipher.rows.length === 0) {
    db.close();
    throw new Error("SQLCipher is not active: the event data would not be encrypted.");
  }
  await db.execute("PRAGMA journal_mode = WAL");
  await db.execute("PRAGMA synchronous = FULL");
  for (const statement of SCHEMA) await db.execute(statement);
  return db;
}

/** Deletes the event database file. */
export function deleteEventDb(db: DB): void {
  db.delete();
}

export async function getSetting(db: Pick<DB, "execute">, key: string): Promise<string | null> {
  const result = await db.execute("SELECT value FROM kv WHERE key = ?", [key]);
  const value = result.rows[0]?.value;
  return typeof value === "string" ? value : null;
}

export async function setSetting(
  db: Pick<DB, "execute">,
  key: string,
  value: string,
): Promise<void> {
  await db.execute(
    "INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
    [key, value],
  );
}

/** A BLOB column as bytes. */
export function blob(value: unknown): Uint8Array | null {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value))
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return null;
}
