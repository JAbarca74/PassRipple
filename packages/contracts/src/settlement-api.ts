// Settlement API (design 10.7 to 10.9, ADR 0039): the event ledger an organizer watches
// live, the settlement statement, the payout a platform administrator records after
// transferring by hand, and the organizer's confirmation that it arrived. The platform
// never moves money: these calls only record what a person did.

import { z } from "zod";

const MAX_CRC = 100_000_000;
const reference = z
  .string()
  .trim()
  .regex(/^[0-9A-Za-z-]{1,64}$/);
const time = z.iso.datetime({ offset: true });

export const LEDGER_KINDS = [
  "payment_in",
  "door_sale",
  "fee",
  "fee_tax",
  "refund",
  "adjustment",
  "payout",
] as const;
export type LedgerKind = (typeof LEDGER_KINDS)[number];

/** One movement of an event's money, signed: money in is positive, money out negative. */
export const ledgerEntry = z.object({
  id: z.uuid(),
  kind: z.enum(LEDGER_KINDS),
  amountCrc: z.int().refine((amount) => amount !== 0),
  reference: z.string().nullable(),
  reason: z.string().nullable(),
  createdAt: time,
});
export type LedgerEntry = z.infer<typeof ledgerEntry>;

/** GET /v1/settlement/events/:id/ledger, oldest first. */
export const ledgerResponse = z.object({ entries: z.array(ledgerEntry) });
export type LedgerResponse = z.infer<typeof ledgerResponse>;

/** The transfer that settled an event, once an administrator records it. */
export const payoutView = z.object({
  amountCrc: z.int().positive(),
  sinpeRef: z.string(),
  paidAt: time,
  /** When an organizer tapped "Received"; null until then. */
  confirmedAt: time.nullable(),
});
export type PayoutView = z.infer<typeof payoutView>;

/**
 * GET /v1/settlement/events/:id/statement and its admin twin. Fee, fee tax, refunds and
 * the amount paid out are magnitudes; adjustments keep their sign. The municipal tax is
 * informative only: the organizer pays it to the municipality.
 */
export const settlementStatement = z.object({
  eventId: z.uuid(),
  collectedCrc: z.int().nonnegative(),
  feeCrc: z.int().nonnegative(),
  feeTaxCrc: z.int().nonnegative(),
  refundsCrc: z.int().nonnegative(),
  adjustmentsCrc: z.int(),
  paidOutCrc: z.int().nonnegative(),
  /** What is still owed to the organizer. Never negative (invariant I9). */
  balanceCrc: z.int().nonnegative(),
  dueAt: time,
  overdue: z.boolean(),
  municipalTaxCrc: z.int().nonnegative(),
  payout: payoutView.nullable(),
});
export type SettlementStatement = z.infer<typeof settlementStatement>;

/** POST /v1/admin/settlement/events/:id/payout: the SINPE transfer a person just made. */
export const recordPayoutRequest = z.object({
  amountCrc: z.int().positive().max(MAX_CRC),
  sinpeRef: reference,
});
export type RecordPayoutRequest = z.output<typeof recordPayoutRequest>;

/**
 * POST /v1/admin/settlement/events/:id/entries: a refund paid back from custody (negative)
 * or an adjustment that corrects a mistake (either sign, with its reason).
 */
export const recordEntryRequest = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("refund"),
    amountCrc: z.int().negative().min(-MAX_CRC),
    reference,
    reason: z.string().trim().max(500).nullable().default(null),
  }),
  z.object({
    kind: z.literal("adjustment"),
    amountCrc: z
      .int()
      .min(-MAX_CRC)
      .max(MAX_CRC)
      .refine((amount) => amount !== 0),
    reference: reference.nullable().default(null),
    reason: z.string().trim().min(1).max(500),
  }),
]);
export type RecordEntryRequest = z.output<typeof recordEntryRequest>;

/** GET /v1/admin/settlement/summary: the two figures the platform never mixes (10.8). */
export const platformTotals = z.object({
  /** Money in the collection account that belongs to organizers or is not yet settled. */
  custodyCrc: z.int(),
  /** Fees and their tax already moved to the platform's own account. */
  ownIncomeCrc: z.int().nonnegative(),
  /** Events past their payout deadline with money still owed. */
  overdueEvents: z.int().nonnegative(),
});
export type PlatformTotals = z.infer<typeof platformTotals>;
