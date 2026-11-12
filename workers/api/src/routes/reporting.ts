// The organizer's live dashboard (design 8.10, Phase 4): counters and gate devices of one
// event. The reporting schema decides who may read it (an organizer of the event's
// organization, or an administrator); the API only shapes the answer.

import type {
  EventDashboard,
  EventExport,
  ExportRow,
  GateDeviceStatus,
  HourlySales,
} from "@passripple/contracts";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../app.ts";
import { userActor } from "../auth.ts";
import { ApiError } from "../errors.ts";
import { iso, isoRequired, param } from "../validation.ts";

const uuid = z.uuid();

interface CountersRow {
  permitted_capacity: number;
  committed: number;
  sold: number;
  courtesies: number;
  door_sales: number;
  admitted: number;
  duplicates: number;
  incidents: number;
  sales_by_hour: HourlySales[];
}

interface DeviceRow {
  device_id: string;
  role: GateDeviceStatus["role"];
  zone: string | null;
  enrolled_at: Date;
  valid_until: Date;
  revoked_at: Date | null;
  last_sync_at: Date | null;
  admitted: number;
  incidents: number;
}

interface ExportDbRow {
  seq: number;
  code_tail: string;
  ticket_type: string;
  zone: string | null;
  origin: ExportRow["origin"];
  status: ExportRow["status"];
  price_crc: number;
  issued_at: Date;
  admitted_at: Date | null;
}

export const reportingRoutes = new Hono<AppEnv>().get("/events/:id/dashboard", async (c) => {
  const eventId = param(c.req.param("id"), uuid);
  const body = await c.var.db.transaction(await userActor(c, "organizer"), async (tx) => {
    const [counters] = await tx<CountersRow[]>`SELECT * FROM reporting.event_counters(${eventId})`;
    if (!counters) throw new ApiError(404, "not_found", "Not found.");
    const devices = await tx<DeviceRow[]>`SELECT * FROM reporting.event_devices(${eventId})`;
    const dashboard: EventDashboard = {
      eventId,
      counters: {
        permittedCapacity: counters.permitted_capacity,
        committed: counters.committed,
        sold: counters.sold,
        courtesies: counters.courtesies,
        doorSales: counters.door_sales,
        admitted: counters.admitted,
        duplicates: counters.duplicates,
        incidents: counters.incidents,
        salesByHour: counters.sales_by_hour,
      },
      devices: devices.map((device) => ({
        deviceId: device.device_id,
        role: device.role,
        zone: device.zone,
        enrolledAt: isoRequired(device.enrolled_at),
        validUntil: isoRequired(device.valid_until),
        revokedAt: iso(device.revoked_at),
        lastSyncAt: iso(device.last_sync_at),
        admitted: device.admitted,
        incidents: device.incidents,
      })),
    };
    return dashboard;
  });
  return c.json(body);
});

// One row per issued ticket, no personal data (the code is cut to its last four characters).
reportingRoutes.get("/events/:id/export", async (c) => {
  const eventId = param(c.req.param("id"), uuid);
  const rows = await c.var.db.transaction(
    await userActor(c, "organizer"),
    (tx) => tx<ExportDbRow[]>`SELECT * FROM reporting.event_export(${eventId})`,
  );
  const body: EventExport = {
    eventId,
    rows: rows.map((row) => ({
      seq: row.seq,
      codeTail: row.code_tail,
      ticketType: row.ticket_type,
      zone: row.zone,
      origin: row.origin,
      status: row.status,
      priceCrc: row.price_crc,
      issuedAt: isoRequired(row.issued_at),
      admittedAt: iso(row.admitted_at),
    })),
  };
  c.header("Cache-Control", "no-store");
  return c.json(body);
});
