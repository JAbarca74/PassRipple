// Staff codes and device enrollment (design 11.2). Organizers create and revoke codes and
// devices for their events; a signed-in staff member enrolls a phone with a code. There is
// no organizer screen until Phase 4: these routes are called directly until then.

import {
  type AssignedBlock,
  assignBlockRequest,
  type ClosedBlock,
  type CreatedStaffCode,
  createStaffCodeRequest,
  type EnrollResponse,
  enrollRequest,
  type StaffCode,
  type StaffRole,
} from "@passripple/contracts";
import { formatHumanCode, HUMAN_CODE_ENTROPY_BYTES, humanCode } from "@passripple/crypto";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../app.ts";
import { userActor } from "../auth.ts";
import { SYSTEM_ACTOR } from "../db.ts";
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

function newTicketCode(): string {
  return humanCode(crypto.getRandomValues(new Uint8Array(HUMAN_CODE_ENTROPY_BYTES)));
}

export const staffRoutes = new Hono<AppEnv>()
  // A block of seats for a door-sales device (design 8.5, 10.6). The organizer's session
  // proves the device is of one of its events; the seats are taken and the block's tickets
  // pre-issued as the system, in one transaction, so a block never exists half made.
  .post("/devices/:id/blocks", async (c) => {
    const deviceId = param(c.req.param("id"), uuid);
    const input = await jsonBody(c, assignBlockRequest);
    const [device] = await c.var.db.transaction(
      await userActor(c, "organizer"),
      (tx) =>
        tx<{ event_id: string; role: string; revoked_at: Date | null }[]>`
        SELECT event_id, role, revoked_at FROM staff.staff_devices WHERE id = ${deviceId}`,
    );
    if (!device) throw new ApiError(404, "not_found", "Not found.");
    if (device.role !== "door_sales" || device.revoked_at !== null) {
      throw new ApiError(409, "not_door_sales", "This device does not sell at the door.");
    }
    const blockId = crypto.randomUUID();
    const codes = `{${Array.from({ length: input.size }, newTicketCode).join(",")}}`;
    await c.var.db.transaction(SYSTEM_ACTOR, async (tx) => {
      const [taken] = await tx<{ ok: boolean }[]>`
        SELECT inventory.assign_block(${blockId}, ${device.event_id}, ${input.ticketTypeId},
                                      ${deviceId}, ${input.size}, 'door_sale') AS ok`;
      if (!taken?.ok) {
        throw new ApiError(409, "sold_out", "There are not enough seats left for this block.");
      }
      await tx`
        SELECT ticketing.issue_block(${blockId}, ${device.event_id}, ${input.ticketTypeId},
                                     'door_sale', ${codes}::text[])`;
    });
    const body: AssignedBlock = {
      blockId,
      deviceId,
      ticketTypeId: input.ticketTypeId,
      size: input.size,
    };
    return c.json(body, 201);
  })

  // Closes a block when the doors close: its unsold tickets are voided and their seats go
  // back to the capacity.
  .post("/blocks/:id/close", async (c) => {
    const blockId = param(c.req.param("id"), uuid);
    const [block] = await c.var.db.transaction(
      await userActor(c, "organizer"),
      (tx) => tx<{ id: string }[]>`SELECT id FROM inventory.device_blocks WHERE id = ${blockId}`,
    );
    if (!block) throw new ApiError(404, "not_found", "Not found.");
    const returned = await c.var.db.transaction(SYSTEM_ACTOR, async (tx) => {
      const [voided] = await tx<{ count: number }[]>`
        SELECT ticketing.void_unsold(${blockId}) AS count`;
      const count = voided?.count ?? 0;
      await tx`SELECT inventory.close_block(${blockId}, ${count})`;
      return count;
    });
    const body: ClosedBlock = { blockId, returned };
    return c.json(body);
  })
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
