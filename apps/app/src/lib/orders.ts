// The orders this device holds: their access tokens and what the payment screen shows. The
// token is the buyer's only credential (6.6); it stays in this origin, which runs no
// third-party script (I8). Clearing the browser's data loses it, and recovery brings the
// tickets back (ADR 0036).

import type { PlacedOrder } from "@passripple/contracts";

const KEY = "passripple.orders";

export interface StoredOrder {
  readonly token: string;
  readonly orderCode: string;
  readonly amountCrc: number;
  readonly amountUnique: boolean;
  readonly sinpeNumber: string;
  readonly expiresAt: string;
  readonly eventName: string;
}

function readAll(): StoredOrder[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(parsed) ? (parsed as StoredOrder[]) : [];
  } catch {
    return [];
  }
}

function writeAll(orders: readonly StoredOrder[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(orders));
  } catch {
    // Private mode or full storage: the order still works in this tab.
  }
}

export function storedOrders(): StoredOrder[] {
  return readAll();
}

export function findOrder(orderCode: string): StoredOrder | undefined {
  return readAll().find((order) => order.orderCode === orderCode);
}

/** Keeps an order, replacing an older entry with the same code (a recovery token, say). */
export function keepOrder(order: StoredOrder): void {
  writeAll([order, ...readAll().filter((kept) => kept.orderCode !== order.orderCode)]);
}

export function storedFromPlaced(placed: PlacedOrder, eventName: string): StoredOrder {
  return {
    token: placed.token,
    orderCode: placed.orderCode,
    amountCrc: placed.amountCrc,
    amountUnique: placed.amountUnique,
    sinpeNumber: placed.sinpeNumber,
    expiresAt: placed.expiresAt,
    eventName,
  };
}
