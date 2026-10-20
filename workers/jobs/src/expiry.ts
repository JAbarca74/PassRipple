// Expiry of pending orders and holds (design 9.3): every minute, orders whose 30 minutes
// are up become expired, which releases their holds and unique amounts and emits
// order.expired; then any hold left active past its time (one with no order) is released.
// Both functions skip rows another run has locked, so two runs at once are safe.

import type { Database } from "./db.ts";

export interface ExpiryReport {
  readonly orders: number;
  readonly holds: number;
}

export async function expire(db: Database): Promise<ExpiryReport> {
  return db.system(async (tx) => {
    const [orders] = await tx<{ count: number }[]>`SELECT orders.expire_orders() AS count`;
    const [holds] = await tx<{ count: number }[]>`SELECT inventory.expire_holds() AS count`;
    return { orders: orders?.count ?? 0, holds: holds?.count ?? 0 };
  });
}
