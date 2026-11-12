// The organizer's live dashboard (design 8.10, Phase 4): counters of an event and the state
// of its gate devices. What is still queued on a phone is not known to the server until it
// is uploaded, so a device carries its last synchronization instead.

import { z } from "zod";
import { STAFF_ROLES } from "./staff-api.ts";

const time = z.iso.datetime({ offset: true });
const count = z.int().nonnegative();

/** Tickets sold online in one hour, Costa Rica time (the hour as a local date-time). */
export const hourlySales = z.object({ hour: z.string(), tickets: count });
export type HourlySales = z.infer<typeof hourlySales>;

export const eventCounters = z.object({
  permittedCapacity: z.int().positive(),
  /** What counts against the permitted capacity: sales, holds, courtesies, door sales. */
  committed: count,
  sold: count,
  courtesies: count,
  doorSales: count,
  /** Distinct tickets let in. */
  admitted: count,
  /** Scans refused because the ticket had already been used. */
  duplicates: count,
  incidents: count,
  /** The last 12 hours, oldest first, empty hours included. */
  salesByHour: z.array(hourlySales),
});
export type EventCounters = z.infer<typeof eventCounters>;

export const gateDeviceStatus = z.object({
  deviceId: z.uuid(),
  role: z.enum(STAFF_ROLES),
  zone: z.string().nullable(),
  enrolledAt: time,
  validUntil: time,
  revokedAt: time.nullable(),
  /** The last time the server received a scan or an incident from it; null if never. */
  lastSyncAt: time.nullable(),
  admitted: count,
  incidents: count,
});
export type GateDeviceStatus = z.infer<typeof gateDeviceStatus>;

/** GET /v1/reporting/events/:id/dashboard */
export const eventDashboard = z.object({
  eventId: z.uuid(),
  counters: eventCounters,
  devices: z.array(gateDeviceStatus),
});
export type EventDashboard = z.infer<typeof eventDashboard>;

/** One ticket of GET /v1/reporting/events/:id/export. No personal data: the code is cut to its tail. */
export const exportRow = z.object({
  seq: z.int().positive(),
  codeTail: z.string(),
  ticketType: z.string(),
  zone: z.string().nullable(),
  origin: z.enum(["sale", "courtesy", "door_sale"]),
  status: z.enum(["issued", "bound", "void"]),
  priceCrc: count,
  issuedAt: time,
  admittedAt: time.nullable(),
});
export type ExportRow = z.infer<typeof exportRow>;

export const eventExport = z.object({ eventId: z.uuid(), rows: z.array(exportRow) });
export type EventExport = z.infer<typeof eventExport>;

/** The header and cells of the export as CSV rows, in the order of the columns. */
export const EXPORT_HEADER = [
  "N",
  "Código (final)",
  "Tipo",
  "Zona",
  "Origen",
  "Estado",
  "Precio (CRC)",
  "Emitida",
  "Ingresó",
] as const;

export function exportCsvRows(rows: readonly ExportRow[]): (string | number | null)[][] {
  return [
    [...EXPORT_HEADER],
    ...rows.map((row) => [
      row.seq,
      row.codeTail,
      row.ticketType,
      row.zone,
      row.origin,
      row.status,
      row.priceCrc,
      row.issuedAt,
      row.admittedAt,
    ]),
  ];
}
