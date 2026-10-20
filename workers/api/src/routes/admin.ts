// Platform administration. Phase 3: a bank notice typed by hand (ADR 0034). It is recorded
// as the administrator, who is named in payments.manual_entries, and then reconciled as the
// system in its own transaction, so a failed reconciliation never loses the notice and
// sending the same notice again simply reconciles it again (I4).

import {
  type ManualNoticeResponse,
  manualNoticeRequest,
  type ReconcileResult,
} from "@passripple/contracts";
import { findPayCodes } from "@passripple/crypto";
import { Hono } from "hono";
import type { AppEnv } from "../app.ts";
import { userActor } from "../auth.ts";
import { SYSTEM_ACTOR } from "../db.ts";
import { manualPaymentProvider } from "../ports/payments.ts";
import { jsonBody } from "../validation.ts";

export const adminRoutes = new Hono<AppEnv>().post("/payments/notices", async (c) => {
  const input = await jsonBody(c, manualNoticeRequest);
  const notice = await manualPaymentProvider.toNotice(input);
  const noticeId = await c.var.db.transaction(await userActor(c, "admin"), async (tx) => {
    const [row] = await tx<{ id: string }[]>`
      SELECT payments.record_manual_notice(${notice.reference}, ${notice.amountCrc},
               ${notice.description}, ${notice.payerName}, ${notice.payerPhone},
               ${notice.paidAt}::timestamptz, ${notice.rawSha256}) AS id`;
    if (!row) throw new Error("payments.record_manual_notice returned nothing");
    return row.id;
  });

  // The description is the payer's text: only well-formed payment codes are taken from it.
  const codes = `{${findPayCodes(notice.description ?? "").join(",")}}`;
  const body = await c.var.db.transaction(SYSTEM_ACTOR, async (tx) => {
    const [row] = await tx<{ result: ReconcileResult; order_code: string | null }[]>`
      SELECT result, order_code FROM payments.reconcile(${noticeId}, ${codes}::text[])`;
    if (!row) throw new Error("payments.reconcile returned nothing");
    const response: ManualNoticeResponse = {
      noticeId,
      result: row.result,
      orderCode: row.order_code,
    };
    return response;
  });
  return c.json(body);
});
