// Staff codes and device enrollment (design 11.2). Organizers create and revoke codes and
// devices for their events; a signed-in staff member enrolls a phone with a code. There is
// no organizer screen until Phase 4: these routes are called directly until then.

import {
  type CreatedStaffCode,
  createStaffCodeRequest,
  type EnrollResponse,
  enrollRequest,
  type StaffCode,
  type StaffRole,
} from "@passripple/contracts";
import { formatHumanCode } from "@passripple/crypto";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../app.ts";
import { userActor } from "../auth.ts";
import { required } from "../env.ts";
import { ApiError } from "../errors.ts";
import {
  canonicalStaffCode,
  DEVICE_TOKEN_PREFIX,
  newStaffCode,
  newToken,
  staffCodeHash,
  tokenHash,
} from "../secrets.ts";
import { iso, isoRequired, jsonBody, param } from "../validation.ts";

const uuid = z.uuid();

interface StaffCodeRow {
  id: string;
  event_id: string;
  role: StaffRole;
  zone: string | null;
  valid_from: Date;
  valid_until: Date;
  max_uses: number;
  uses: number;
  created_at: Date;
  revoked_at: Date | null;
}

function staffCodeView(row: StaffCodeRow): StaffCode {
  return {
    id: row.id,
    eventId: row.event_id,
    role: row.role,
    zone: row.zone,
    validFrom: isoRequired(row.valid_from),
    validUntil: isoRequired(row.valid_until),
    maxUses: row.max_uses,
    uses: row.uses,
    createdAt: isoRequired(row.created_at),
    revokedAt: iso(row.revoked_at),
  };
}

export const staffRoutes = new Hono<AppEnv>()
  // ── Organizers ────────────────────────────────────────────────────────────
  .post("/codes", async (c) => {
    const input = await jsonBody(c, createStaffCodeRequest);
    const code = newStaffCode();
    const hash = await staffCodeHash(required(c.env, "SIGN_IN_PEPPER"), code);
    const row = await c.var.db.transaction(await userActor(c, "organizer"), async (tx) => {
      const [{ id }] = await tx<[{ id: string }]>`
        SELECT staff.create_code(${input.eventId}, ${hash}, ${input.role}, ${input.zone},
                                 ${input.validFrom}, ${input.validUntil}, ${input.maxUses}) AS id`;
      const [created] = await tx<StaffCodeRow[]>`
        SELECT id, event_id, role, zone, valid_from, valid_until, max_uses, uses, created_at, revoked_at
          FROM staff.staff_codes WHERE id = ${id}`;
      return created;
    });
    if (!row) throw new Error("the new staff code was not found");
    const body: CreatedStaffCode = { ...staffCodeView(row), code: formatHumanCode(code) };
    return c.json(body, 201);
  })

  .get("/codes", async (c) => {
    const eventId = param(c.req.query("eventId"), uuid);
    const rows = await c.var.db.transaction(
      await userActor(c, "organizer"),
      (tx) => tx<StaffCodeRow[]>`
        SELECT id, event_id, role, zone, valid_from, valid_until, max_uses, uses, created_at, revoked_at
          FROM staff.staff_codes WHERE event_id = ${eventId} ORDER BY created_at`,
    );
    return c.json({ codes: rows.map(staffCodeView) });
  })

  .post("/codes/:id/revoke", async (c) => {
    const id = param(c.req.param("id"), uuid);
    await c.var.db.transaction(await userActor(c, "organizer"), async (tx) => {
      await tx`SELECT staff.revoke_code(${id})`;
    });
    return c.body(null, 204);
  })

  .post("/devices/:id/revoke", async (c) => {
    const id = param(c.req.param("id"), uuid);
    await c.var.db.transaction(await userActor(c, "organizer"), async (tx) => {
      await tx`SELECT staff.revoke_device(${id})`;
    });
    return c.body(null, 204);
  })

  // ── Staff ─────────────────────────────────────────────────────────────────
  .post("/enroll", async (c) => {
    const input = await jsonBody(c, enrollRequest);
    const code = canonicalStaffCode(input.staffCode);
    if (code === null) throw new ApiError(404, "not_found", "Not found.");
    const hash = await staffCodeHash(required(c.env, "SIGN_IN_PEPPER"), code);
    const integrity = await c.var.integrity.verify({
      platform: input.platform,
      token: input.integrityToken,
    });
    const deviceToken = newToken(DEVICE_TOKEN_PREFIX);
    const deviceHash = await tokenHash(deviceToken);
    const device = await c.var.db.transaction(await userActor(c, "staff"), async (tx) => {
      const [{ id }] = await tx<[{ id: string }]>`
        SELECT staff.enroll(${hash}, ${deviceHash}, ${input.platform}, ${input.appVersion},
                            ${integrity}) AS id`;
      const [row] = await tx<(StaffCodeRow & { device_id: string })[]>`
        SELECT id AS device_id, event_id, role, zone, valid_from, valid_until
          FROM staff.staff_devices WHERE id = ${id}`;
      return row;
    });
    if (!device) throw new Error("the new device was not found");
    const body: EnrollResponse = {
      deviceToken,
      device: {
        deviceId: device.device_id,
        eventId: device.event_id,
        role: device.role,
        zone: device.zone,
        validFrom: isoRequired(device.valid_from),
        validUntil: isoRequired(device.valid_until),
        status: Date.parse(isoRequired(device.valid_until)) <= Date.now() ? "expired" : "active",
      },
    };
    return c.json(body, 201);
  });
