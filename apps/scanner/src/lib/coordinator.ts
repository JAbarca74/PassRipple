// The gate's side of the optional LAN coordinator (design 8.2). Several gates that take the
// same ticket type ask the zone's coordinator, on the venue's own Wi-Fi, who admitted a
// ticket first. The coordinator never replaces the manifest: if it cannot be reached within
// a short time, the gate decides alone and duplicates are found when the batches reconcile
// (I6: no operation is lost and no gate waits for the network).

import type { GateDecision } from "./verify.ts";

export interface CoordinatorConfig {
  /** Base URL on the local network, such as http://192.168.1.10:8800 */
  readonly url: string;
  /** The zone's shared token, handed out by the organizer. */
  readonly token: string;
}

export type CoordinatorAnswer =
  | { readonly kind: "granted" }
  | { readonly kind: "already"; readonly deviceId: string; readonly claimedAt: number }
  | { readonly kind: "unreachable" };

/** How long a gate waits for the coordinator before deciding alone. */
export const COORDINATOR_TIMEOUT_MS = 1_200;

/** Asks the coordinator to claim a ticket for this device. Never throws. */
export async function claimWithCoordinator(
  config: CoordinatorConfig,
  ticketId: string,
  deviceId: string,
  fetchFn: typeof fetch = fetch,
  timeoutMs: number = COORDINATOR_TIMEOUT_MS,
): Promise<CoordinatorAnswer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchFn(`${config.url}/v1/claim`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-coordinator-token": config.token },
      body: JSON.stringify({ ticketId, deviceId }),
      signal: controller.signal,
    });
    if (!response.ok) return { kind: "unreachable" };
    const body = (await response.json()) as {
      status?: string;
      deviceId?: string;
      claimedAt?: number;
    };
    if (body.status === "granted") return { kind: "granted" };
    if (
      body.status === "already" &&
      typeof body.deviceId === "string" &&
      typeof body.claimedAt === "number"
    ) {
      return { kind: "already", deviceId: body.deviceId, claimedAt: body.claimedAt };
    }
    return { kind: "unreachable" };
  } catch {
    return { kind: "unreachable" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Applies the coordinator's answer to the gate's own decision. Only an admission of a
 * single-use ticket that another gate already claimed changes: it becomes a rejection. A
 * multi-scan ticket, a rejection or an unreachable coordinator leave the decision as it was.
 */
export function withCoordinatorAnswer(
  decision: GateDecision,
  answer: CoordinatorAnswer,
): GateDecision {
  if (decision.kind !== "admit" || decision.entryMode !== "single_use") return decision;
  if (answer.kind !== "already") return decision;
  return {
    kind: "reject",
    reason: "already_redeemed",
    ticketId: decision.ticketId,
    typeName: decision.typeName,
  };
}
