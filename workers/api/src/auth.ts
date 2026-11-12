// Who is calling. A request carries one bearer token: a person's session (`pru_…`) or a gate
// device's session (`prd_…`). The token's hash is looked up inside the request's own
// transaction, and what it resolves to becomes the transaction's actor (ADR 0009).

import type { DeviceStatus, GateDevice, StaffRole } from "@passripple/contracts";
import type { Context } from "hono";
import type { Actor, ActorRole, Tx } from "./db.ts";
import { ApiError } from "./errors.ts";
import { DEVICE_TOKEN_PREFIX, tokenHash, USER_TOKEN_PREFIX } from "./secrets.ts";
import { isoRequired } from "./validation.ts";

const UNAUTHORIZED = () => new ApiError(401, "unauthorized", "Sign in again.");

/** The bearer token of a request, if it has the expected prefix. */
export function bearer(c: Context, prefix: string): string {
  const header = c.req.header("authorization") ?? "";
  const match = /^Bearer (\S+)$/.exec(header);
  const token = match?.[1];
  if (!token?.startsWith(prefix) || token.length > 128) throw UNAUTHORIZED();
  return token;
}

/**
 * The actor for a person's session token, acting in `role` (and, for organizers, for the
 * organization in the `X-Org-Id` header). identity.set_actor then checks that the person
 * may take that role and belongs to that organization.
 */
export async function userActor(
  c: Context,
  role: Exclude<ActorRole, "buyer" | "system">,
): Promise<(tx: Tx) => Promise<Actor>> {
  const hash = await tokenHash(bearer(c, USER_TOKEN_PREFIX));
  const orgId = role === "organizer" ? (c.req.header("x-org-id") ?? null) : null;
  if (role === "organizer" && (orgId === null || !/^[0-9a-f-]{36}$/i.test(orgId))) {
    throw new ApiError(400, "invalid_request", "X-Org-Id must name the organization.");
  }
  return async (tx) => {
    const [row] = await tx<{ user_id: string | null }[]>`
      SELECT identity.authenticate_session(${hash}) AS user_id`;
    if (!row?.user_id) throw UNAUTHORIZED();
    return { id: row.user_id, role, orgId };
  };
}

/** A gate device, as its session token resolved it. */
export interface AuthenticatedDevice extends GateDevice {
  readonly userId: string;
  readonly revokedAt: string | null;
}

interface DeviceRow {
  device_id: string;
  user_id: string;
  event_id: string;
  role: StaffRole;
  zone: string | null;
  valid_from: Date;
  valid_until: Date;
  revoked_at: Date | null;
  status: DeviceStatus;
}

/**
 * Resolves a gate device's session token into the actor of the transaction: its staff
 * member, acting as staff. `allowed` says which device statuses may make the request;
 * revoked and expired devices may only upload (I6). `found` receives the device.
 */
export async function deviceActor(
  c: Context,
  allowed: readonly DeviceStatus[],
  found: (device: AuthenticatedDevice) => void,
): Promise<(tx: Tx) => Promise<Actor>> {
  const hash = await tokenHash(bearer(c, DEVICE_TOKEN_PREFIX));
  return async (tx) => {
    const [row] = await tx<DeviceRow[]>`SELECT * FROM staff.authenticate_device(${hash})`;
    if (!row) throw UNAUTHORIZED();
    const device: AuthenticatedDevice = {
      deviceId: row.device_id,
      userId: row.user_id,
      eventId: row.event_id,
      role: row.role,
      zone: row.zone,
      validFrom: isoRequired(row.valid_from),
      validUntil: isoRequired(row.valid_until),
      revokedAt: row.revoked_at === null ? null : isoRequired(row.revoked_at),
      status: row.status,
    };
    if (!allowed.includes(device.status)) {
      throw new ApiError(403, `device_${device.status}`, `This device is ${device.status}.`);
    }
    found(device);
    return { id: device.userId, role: "staff", orgId: null };
  };
}

/** The public view of a device, as gate devices receive it. */
export function gateDeviceView(device: AuthenticatedDevice): GateDevice {
  const { deviceId, eventId, role, zone, validFrom, validUntil, status } = device;
  return { deviceId, eventId, role, zone, validFrom, validUntil, status };
}
