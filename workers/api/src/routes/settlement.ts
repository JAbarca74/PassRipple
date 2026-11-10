// Settlement (design 10.7 to 10.9, ADR 0039). Organizers watch their event's ledger and
// statement and confirm the payout arrived; a platform administrator records the transfer
// made by hand, refunds and adjustments, and reads custody against own income. Every rule
// lives in the settlement schema: invariant I9, the claims window and who may do what.
// The API only shapes requests and answers.

import {
  type LedgerResponse,
  type PlatformTotals,
  recordEntryRequest,
  recordPayoutRequest,
  type SettlementStatement,
} from "@passripple/contracts";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../app.ts";
import { userActor } from "../auth.ts";
import type { Tx } from "../db.ts";
import { ApiError } from "../errors.ts";
import { iso, isoRequired, jsonBody, param } from "../validation.ts";

const uuid = z.uuid();

interface LedgerRow {
  id: string;
  kind: LedgerResponse["entries"][number]["kind"];
  amount_crc: number;
  reference: string | null;
  reason: string | null;
  created_at: Date;
}

interface StatementRow {
  collected_crc: number;
  fee_crc: number;
  fee_tax_crc: number;
  refunds_crc: number;
  adjustments_crc: number;
  paid_out_crc: number;
  balance_crc: number;
  due_at: Date;
  overdue: boolean;
  municipal_tax_crc: number;
}

interface PayoutRow {
  amount_crc: number;
  sinpe_ref: string;
  paid_at: Date;
  confirmed_at: Date | null;
}

/** The statement as the actor of this transaction may see it (settlement checks who). */
async function statement(tx: Tx, eventId: string): Promise<SettlementStatement> {
  const [row] = await tx<StatementRow[]>`SELECT * FROM settlement.statement(${eventId})`;
  if (!row) throw new ApiError(404, "not_found", "Not found.");
  // RLS shows the payout row only to the same actors statement() admits.
  const [payout] = await tx<PayoutRow[]>`
    SELECT amount_crc, sinpe_ref, paid_at, confirmed_at
      FROM settlement.payouts WHERE event_id = ${eventId}`;
  return {
    eventId,
    collectedCrc: row.collected_crc,
    feeCrc: row.fee_crc,
    feeTaxCrc: row.fee_tax_crc,
    refundsCrc: row.refunds_crc,
    adjustmentsCrc: row.adjustments_crc,
    paidOutCrc: row.paid_out_crc,
    balanceCrc: row.balance_crc,
    dueAt: isoRequired(row.due_at),
    overdue: row.overdue,
    municipalTaxCrc: row.municipal_tax_crc,
    payout: payout
      ? {
          amountCrc: payout.amount_crc,
          sinpeRef: payout.sinpe_ref,
          paidAt: isoRequired(payout.paid_at),
          confirmedAt: iso(payout.confirmed_at),
        }
      : null,
  };
}

// ── Organizers (X-Org-Id names the organization; identity checks membership) ──
export const settlementRoutes = new Hono<AppEnv>()
  // Every movement of the event's money, oldest first, with its bank reference.
  .get("/events/:id/ledger", async (c) => {
    const eventId = param(c.req.param("id"), uuid);
    const rows = await c.var.db.transaction(
      await userActor(c, "organizer"),
      (tx) => tx<LedgerRow[]>`
        SELECT id, kind, amount_crc, reference, reason, created_at
          FROM settlement.ledger_entries
         WHERE event_id = ${eventId}
         ORDER BY created_at, id`,
    );
    const body: LedgerResponse = {
      entries: rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        amountCrc: row.amount_crc,
        reference: row.reference,
        reason: row.reason,
        createdAt: isoRequired(row.created_at),
      })),
    };
    return c.json(body);
  })

  .get("/events/:id/statement", async (c) => {
    const eventId = param(c.req.param("id"), uuid);
    const body = await c.var.db.transaction(await userActor(c, "organizer"), (tx) =>
      statement(tx, eventId),
    );
    return c.json(body);
  })

  // The organizer taps "Received" once the transfer is in their account.
  .post("/events/:id/payout/confirm", async (c) => {
    const eventId = param(c.req.param("id"), uuid);
    const body = await c.var.db.transaction(await userActor(c, "organizer"), async (tx) => {
      await tx`SELECT settlement.confirm_payout(${eventId})`;
      return statement(tx, eventId);
    });
    return c.json(body);
  });

// ── Platform administrators ─────────────────────────────────────────────────
export const adminSettlementRoutes = new Hono<AppEnv>()
  .get("/summary", async (c) => {
    const [row] = await c.var.db.transaction(
      await userActor(c, "admin"),
      (tx) => tx<{ custody_crc: string; own_income_crc: string; overdue_events: number }[]>`
        SELECT custody_crc::text, own_income_crc::text, overdue_events
          FROM settlement.platform_totals()`,
    );
    if (!row) throw new Error("settlement.platform_totals returned nothing");
    const body: PlatformTotals = {
      custodyCrc: Number(row.custody_crc),
      ownIncomeCrc: Number(row.own_income_crc),
      overdueEvents: row.overdue_events,
    };
    return c.json(body);
  })

  .get("/events/:id/statement", async (c) => {
    const eventId = param(c.req.param("id"), uuid);
    const body = await c.var.db.transaction(await userActor(c, "admin"), (tx) =>
      statement(tx, eventId),
    );
    return c.json(body);
  })

  // Records the SINPE transfer an administrator just made. I9 refuses more than is owed;
  // the claims window refuses it too early; a second payout for the event is a conflict.
  .post("/events/:id/payout", async (c) => {
    const eventId = param(c.req.param("id"), uuid);
    const input = await jsonBody(c, recordPayoutRequest);
    const body = await c.var.db.transaction(await userActor(c, "admin"), async (tx) => {
      await tx`SELECT settlement.record_payout(${eventId}, ${input.amountCrc}, ${input.sinpeRef})`;
      return statement(tx, eventId);
    });
    return c.json(body, 201);
  })

  // A refund paid back from custody, or an adjustment with its reason. I9 still applies.
  .post("/events/:id/entries", async (c) => {
    const eventId = param(c.req.param("id"), uuid);
    const input = await jsonBody(c, recordEntryRequest);
    const body = await c.var.db.transaction(await userActor(c, "admin"), async (tx) => {
      await tx`SELECT settlement.record_entry(${eventId}, ${input.kind}, ${input.amountCrc},
                                              ${input.reference}, ${input.reason})`;
      return statement(tx, eventId);
    });
    return c.json(body, 201);
  });
