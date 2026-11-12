// The PaymentProvider port (rule R5, design 10.2 to 10.4, ADR 0034): whatever channel a bank
// notice arrives through, an adapter turns it into one PaymentNotice, and reconciliation
// never sees anything else. Phase 3 has one adapter, a platform administrator typing a
// notice by hand; parsers for the bank's own notices arrive when anonymized real ones exist.
//
// The description is the payer's own text: it is carried as untrusted data, bounded in
// length, and only ever searched for well-formed payment codes. Nothing in it is followed.

import { z } from "zod";

/** A bank notice in the only shape reconciliation accepts. */
export interface PaymentNotice {
  /** The channel it came through: an identifier of the adapter, never a bank's name. */
  readonly source: string;
  /** The bank's reference for the transfer: unique per source (invariant I4). */
  readonly reference: string;
  readonly amountCrc: number;
  /** Written by the payer. Untrusted. */
  readonly description: string | null;
  readonly payerName: string | null;
  readonly payerPhone: string | null;
  /** When the bank says the money moved. */
  readonly paidAt: string;
  /** SHA-256 of the notice as received, kept as evidence. */
  readonly rawSha256: Uint8Array;
}

/** Turns what a channel delivers into a notice, or throws when it is not one. */
export interface PaymentProvider<Input> {
  readonly source: string;
  toNotice(input: Input): Promise<PaymentNotice>;
}

/** Results of reconciling a notice with the orders. */
export const RECONCILE_RESULTS = [
  "paid",
  "refund_due",
  "already_confirmed",
  "surplus",
  "amount_mismatch",
  "ambiguous",
  "unmatched",
] as const;
export type ReconcileResult = (typeof RECONCILE_RESULTS)[number];

// Letters, digits, punctuation and spaces: no control characters, so a description cannot
// carry line breaks or invisible text into a screen or a log.
const printable = /^[^\p{Cc}\p{Cf}]*$/u;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .regex(printable)
    .transform((text) => (text === "" ? null : text))
    .nullable()
    .default(null);

/** POST /v1/admin/payments/notices: a notice typed by a platform administrator. */
export const manualNoticeRequest = z.object({
  reference: z
    .string()
    .trim()
    .regex(/^[0-9A-Za-z-]{1,64}$/),
  amountCrc: z.int().positive().max(100_000_000),
  description: optionalText(500),
  payerName: optionalText(120),
  payerPhone: z
    .string()
    .trim()
    .regex(/^\+?[0-9]{8,15}$/)
    .nullable()
    .default(null),
  paidAt: z.iso.datetime({ offset: true }),
});
export type ManualNoticeRequest = z.output<typeof manualNoticeRequest>;

export const manualNoticeResponse = z.object({
  noticeId: z.uuid(),
  result: z.enum(RECONCILE_RESULTS),
  /** The code of the order it was matched to, if any. */
  orderCode: z.string().nullable(),
});
export type ManualNoticeResponse = z.infer<typeof manualNoticeResponse>;

// ── Bank statement (design 10.4) ─────────────────────────────────────────────

const isoDate = z.iso.date();

/** One credit of the account's statement, already parsed from the bank's export. */
export const statementLine = z.object({
  bookedOn: isoDate,
  reference: z
    .string()
    .trim()
    .regex(/^[0-9A-Za-z-]{1,64}$/),
  amountCrc: z.int().positive().max(100_000_000),
  description: optionalText(500),
});
export type StatementLine = z.output<typeof statementLine>;

/** POST /v1/admin/payments/statements: the credits of the days from `from` to `to`. */
export const statementImportRequest = z
  .object({
    from: isoDate,
    to: isoDate,
    lines: z.array(statementLine).max(5000),
  })
  .refine((statement) => statement.from <= statement.to, { message: "from is after to" });
export type StatementImportRequest = z.output<typeof statementImportRequest>;

export const STATEMENT_FINDINGS = ["missing", "amount_differs"] as const;

export const statementImportResponse = z.object({
  statementId: z.uuid(),
  /** Payments of the period the statement does not back. */
  findings: z.array(
    z.object({
      orderCode: z.string(),
      reference: z.string(),
      amountCrc: z.int().positive(),
      paidOn: isoDate,
      finding: z.enum(STATEMENT_FINDINGS),
    }),
  ),
});
export type StatementImportResponse = z.infer<typeof statementImportResponse>;
