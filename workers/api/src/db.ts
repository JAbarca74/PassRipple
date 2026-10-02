// The API's only way to the database. Every unit of work is one transaction, and the first
// statement of that transaction sets who is acting, through identity.set_actor (ADR 0009),
// so Row Level Security applies to everything that follows. The settings are
// transaction-local, which is what Hyperdrive's transaction pooling needs: nothing of one
// request's actor survives on the pooled connection.

import postgres from "postgres";

export type ActorRole = "buyer" | "organizer" | "staff" | "inspector" | "admin" | "system";

/** Who a transaction acts as. Buyers and the system act with no account or organization. */
export interface Actor {
  readonly id: string | null;
  readonly role: ActorRole;
  readonly orgId: string | null;
}

export const SYSTEM_ACTOR: Actor = { id: null, role: "system", orgId: null };

/** A transaction, with its actor already set. */
export type Tx = postgres.TransactionSql;

/**
 * The actor of a transaction: known in advance, or found inside the transaction before it
 * is set (for example, from a session token), so both happen in one round of work.
 */
export type ActorSource = Actor | ((tx: Tx) => Promise<Actor>);

export interface Database {
  /** Runs `work` in one transaction acting as `actor`. Rolls back if anything throws. */
  transaction<T>(actor: ActorSource, work: (tx: Tx) => Promise<T>): Promise<T>;
  /** Releases the connections. Safe to call when nothing was queried. */
  close(): Promise<void>;
}

/** One request's connection. postgres() connects lazily, on the first query. */
export function connect(connectionString: string): Database {
  const sql = postgres(connectionString, {
    // Hyperdrive keeps the pool; one Worker invocation needs only a few connections.
    max: 5,
    // Skips the type lookup on each new connection: uuids and timestamps come back as text.
    fetch_types: false,
  });
  return {
    async transaction<T>(actor: ActorSource, work: (tx: Tx) => Promise<T>): Promise<T> {
      const result = await sql.begin(async (tx) => {
        const who = typeof actor === "function" ? await actor(tx) : actor;
        await tx`SELECT identity.set_actor(${who.id}::uuid, ${who.role}, ${who.orgId}::uuid)`;
        return work(tx);
      });
      return result as T;
    },
    close: () => sql.end({ timeout: 5 }),
  };
}
