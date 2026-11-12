// The operations a gate device records offline and uploads in batches (design 8.4, 8.7).
// None of them can be refused by the server (invariant I6): a second scan of a ticket is
// recorded as a duplicate, not rejected. Door sales and complimentary grants join in
// Phase 7, each with its own pre-assigned block so they stay unrejectable too (8.5).

import { z } from "zod";

export const GATE_OPERATION_TYPES = [
  "redemption",
  "staff_scan",
  "incident",
  "attendee_capture",
  "door_sale",
] as const;
export type GateOperationType = (typeof GATE_OPERATION_TYPES)[number];

/** A scanned ticket: a single-use admission or a multi-scan entry of staff or performers. */
export interface ScanPayload {
  /** Lowercase UUID. */
  readonly ticketId: string;
  readonly method: "qr" | "manual";
  /** Whether the operator checked an identity document (named and 18+ events). */
  readonly idChecked: boolean;
  /** False when the credential verified but the ticket was not in the device's manifest. */
  readonly inManifest: boolean;
}

/** Incidents a device reports itself. Reconciliation raises others on the server. */
export const DEVICE_INCIDENT_KINDS = ["operator", "manual_entry_locked"] as const;
export type DeviceIncidentKind = (typeof DEVICE_INCIDENT_KINDS)[number];

export interface IncidentPayload {
  readonly kind: DeviceIncidentKind;
  readonly ticketId: string | null;
  /** A short note, at most 500 characters, with no personal data. */
  readonly note: string | null;
}

/**
 * A named ticket's attendee taken at the door from the document in hand (7.3): the name, the
 * document type and its last digits, never the whole number.
 */
export interface AttendeeCapturePayload {
  readonly ticketId: string;
  readonly fullName: string;
  readonly docType: "cedula" | "dimex" | "pasaporte" | "tim";
  /** 2 to 4 letters or digits. */
  readonly docLast4: string;
}

/**
 * A ticket of the device's block sold at the door (10.6): paid to the organizer in cash or by
 * SINPE to the organizer's own number. The device also queues the ticket's admission.
 */
export interface DoorSalePayload {
  readonly ticketId: string;
  readonly method: "cash" | "sinpe";
  /** What the person paid, in colones. */
  readonly amountCrc: number;
}

interface OperationBase {
  /** Device-generated UUIDv7. */
  readonly id: string;
  /** The device's monotonic counter. */
  readonly deviceSeq: number;
  /** Device wall clock in milliseconds when it happened. */
  readonly createdAt: number;
  /** The device's clock correction then, in milliseconds. */
  readonly clockOffsetMs: number;
}

export type GateOperation =
  | (OperationBase & {
      readonly opType: "redemption" | "staff_scan";
      readonly payload: ScanPayload;
    })
  | (OperationBase & { readonly opType: "incident"; readonly payload: IncidentPayload })
  | (OperationBase & {
      readonly opType: "attendee_capture";
      readonly payload: AttendeeCapturePayload;
    })
  | (OperationBase & { readonly opType: "door_sale"; readonly payload: DoorSalePayload });

/**
 * A batch as the API accepts it. Only the envelope is checked here: each operation is
 * checked by the database on its own, so one malformed operation is rejected alone instead
 * of failing the batch.
 */
export const gateBatchRequest = z.object({
  items: z
    .array(z.looseObject({ id: z.string().max(64) }))
    .min(1)
    .max(100),
});
export type GateBatchRequest = { readonly items: readonly GateOperation[] };

export const BATCH_ITEM_STATUSES = ["applied", "duplicate", "rejected"] as const;

export const gateBatchItemResult = z.object({
  id: z.string(),
  /** applied: stored now; duplicate: stored before (the same id synced again); rejected. */
  status: z.enum(BATCH_ITEM_STATUSES),
  /** For scans: whether the ticket was admitted or was already admitted. */
  outcome: z.enum(["admitted", "duplicate"]).optional(),
  error: z.string().optional(),
});
export type GateBatchItemResult = z.infer<typeof gateBatchItemResult>;

export const gateBatchResponse = z.object({
  results: z.array(gateBatchItemResult),
  serverTime: z.int().nonnegative(),
});
export type GateBatchResponse = z.infer<typeof gateBatchResponse>;
