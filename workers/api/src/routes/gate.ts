// Routes for enrolled gate devices, authenticated by their device token. Active devices do
// everything; revoked and expired devices may only upload what they recorded (I6), learn
// their status and sign out.

import {
  DEVICE_STATUSES,
  type DeviceStatus,
  decodeServerKeys,
  encodeGateManifest,
  encodeGateManifestDelta,
  type GateBatchItemResult,
  type GateBatchResponse,
  type GateSessionResponse,
  gateBatchRequest,
  type ManifestServerKey,
  manifestCursor,
} from "@passripple/contracts";
import {
  buildGateManifest,
  buildGateManifestDelta,
  type GateEventRow,
  type GateTicketRow,
  type GateTicketTypeRow,
} from "@passripple/manifest";
import { type Context, Hono } from "hono";
import type { AppEnv } from "../app.ts";
import { type AuthenticatedDevice, deviceActor, gateDeviceView } from "../auth.ts";
import type { Tx } from "../db.ts";
import { type Env, required } from "../env.ts";
import { ApiError } from "../errors.ts";
import { jsonBody, param } from "../validation.ts";

/** Runs `work` for the device behind the request's token, if its status is allowed. */
export async function forDevice<T>(
  c: Context<AppEnv>,
  allowed: readonly DeviceStatus[],
  work: (device: AuthenticatedDevice, tx: Tx) => Promise<T>,
): Promise<T> {
  let device: AuthenticatedDevice | undefined;
  const actor = await deviceActor(c, allowed, (found) => {
    device = found;
  });
  return c.var.db.transaction(actor, (tx) => {
    if (!device) throw new Error("the device was not resolved");
    return work(device, tx);
  });
}

// The envelope was checked; the database checks each operation (it is plain JSON).
type JsonArray = Parameters<Tx["json"]>[0];

function serverKeys(env: Env): ManifestServerKey[] {
  let json: unknown;
  try {
    json = JSON.parse(required(env, "SERVER_PUBLIC_KEYS"));
  } catch {
    json = null;
  }
  const keys = decodeServerKeys(json);
  if (keys === null) throw new Error("SERVER_PUBLIC_KEYS is not a valid key ring");
  return keys;
}

export const gateRoutes = new Hono<AppEnv>()
  // The device's status and the server clock. Every status may ask.
  .get("/session", async (c) => {
    const device = await forDevice(c, DEVICE_STATUSES, async (found) => found);
    const body: GateSessionResponse = { device: gateDeviceView(device), serverTime: Date.now() };
    return c.json(body);
  })

  // The event's manifest: whole, or what changed since a cursor (design 8.3). Active
  // devices only: revoked and expired devices get no manifest (ADR 0018).
  .get("/manifest", async (c) => {
    const sinceText = c.req.query("since");
    const since = sinceText === undefined ? null : param(sinceText, manifestCursor);
    const keys = serverKeys(c.env);
    const body = await forDevice(c, ["active"], async (device, tx) => {
      // The cursor first: anything changed after it is read now or sent next time.
      const [cursorRow] = await tx<{ cursor: string }[]>`SELECT manifest.cursor()::text AS cursor`;
      const [event] = await tx<
        GateEventRow[]
      >`SELECT * FROM manifest.gate_event(${device.deviceId})`;
      const ticketTypes = await tx<GateTicketTypeRow[]>`
        SELECT * FROM manifest.gate_ticket_types(${device.deviceId})`;
      const tickets = await tx<GateTicketRow[]>`
        SELECT * FROM manifest.gate_tickets(${device.deviceId}, ${since}::xid8)`;
      if (!cursorRow || !event) throw new ApiError(404, "not_found", "Not found.");
      const input = {
        event,
        serverKeys: keys,
        ticketTypes,
        tickets,
        cursor: cursorRow.cursor,
        serverTime: Date.now(),
      };
      return since === null
        ? encodeGateManifest(buildGateManifest(input))
        : encodeGateManifestDelta(buildGateManifestDelta({ ...input, since }));
    });
    return c.json(body);
  })

  // Uploads a batch of offline operations (design 8.7). Always 200 with one result per
  // operation. Every status may upload: a revoked or expired device still delivers what it
  // recorded (I6).
  .post("/batches", async (c) => {
    const { items } = await jsonBody(c, gateBatchRequest);
    const results = await forDevice(c, DEVICE_STATUSES, async (device, tx) => {
      const [row] = await tx<{ results: GateBatchItemResult[] }[]>`
        SELECT redemption.apply_batch(${device.deviceId}, ${tx.json(items as JsonArray)}) AS results`;
      return row?.results ?? [];
    });
    const body: GateBatchResponse = { results, serverTime: Date.now() };
    return c.json(body);
  })

  // Signs the device out for good. The app allows it only with nothing left to upload (8.9).
  .post("/sign-out", async (c) => {
    await forDevice(c, DEVICE_STATUSES, async (device, tx) => {
      await tx`SELECT staff.sign_out_device(${device.deviceId})`;
    });
    return c.body(null, 204);
  });
