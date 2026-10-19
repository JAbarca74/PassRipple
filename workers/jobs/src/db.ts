// The jobs Worker's way to the database, as in workers/api (ADR 0017): one transaction per
// unit of work, and its first statement sets the actor. Jobs always act as the system.
// Workers cannot depend on each other, so this is a copy of the API's helper, reduced to
// what jobs need.

import postgres from "postgres";

/** A transaction, acting as the system. */
export type Tx = postgres.TransactionSql;

export interface Database {
  /** Runs `work` in one transaction acting as the system. Rolls back if anything throws. */
  system<T>(work: (tx: Tx) => Promise<T>): Promise<T>;
  /** Releases the connections. Safe to call when nothing was queried. */
  close(): Promise<void>;
}

export function connect(connectionString: string): Database {
  const sql = postgres(connectionString, { max: 5, fetch_types: false });
  return {
    async system<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
      const result = await sql.begin(async (tx) => {
        await tx`SELECT identity.set_actor(NULL, 'system', NULL)`;
        return work(tx);
      });
      return result as T;
    },
    close: () => sql.end({ timeout: 5 }),
  };
}
