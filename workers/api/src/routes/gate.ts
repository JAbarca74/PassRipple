// Routes for enrolled gate devices, authenticated by their device token. Active devices do
// everything; revoked and expired devices may only upload what they recorded (I6), learn
// their status and sign out.

import {
  DEVICE_STATUSES,
  type DeviceStatus,
  type GateSessionResponse,
} from "@passripple/contracts";
import { type Context, Hono } from "hono";
import type { AppEnv } from "../app.ts";
import { type AuthenticatedDevice, deviceActor, gateDeviceView } from "../auth.ts";
import type { Tx } from "../db.ts";

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

export const gateRoutes = new Hono<AppEnv>()
  // The device's status and the server clock. Every status may ask.
  .get("/session", async (c) => {
    const device = await forDevice(c, DEVICE_STATUSES, async (found) => found);
    const body: GateSessionResponse = { device: gateDeviceView(device), serverTime: Date.now() };
    return c.json(body);
  })

  // Signs the device out for good. The app allows it only with nothing left to upload (8.9).
  .post("/sign-out", async (c) => {
    await forDevice(c, DEVICE_STATUSES, async (device, tx) => {
      await tx`SELECT staff.sign_out_device(${device.deviceId})`;
    });
    return c.body(null, 204);
  });
