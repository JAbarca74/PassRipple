// Platform administration. Phase 3: a bank notice typed by hand (ADR 0034). It is recorded
// as the administrator, who is named in payments.manual_entries, and then reconciled as the
// system in its own transaction, so a failed reconciliation never loses the notice and
// sending the same notice again simply reconciles it again (I4). And the bank statement
// (design 10.4): its credits, already parsed, checked against the confirmed payments.

import {
  grantInspectorRequest,
  type ManualNoticeResponse,
  manualNoticeRequest,
  type ReconcileResult,
  revokeInspectorRequest,
  type StatementImportResponse,
  statementImportRequest,
} from "@passripple/contracts";
import { findPayCodes } from "@passripple/crypto";
import { Hono } from "hono";
import type { AppEnv } from "../app.ts";
import { userActor } from "../auth.ts";
import { SYSTEM_ACTOR } from "../db.ts";
import { manualPaymentProvider } from "../ports/payments.ts";
import { sha256 } from "../secrets.ts";
import { jsonBody } from "../validation.ts";

type Finding = StatementImportResponse["findings"][number];

export const adminRoutes = new Hono<AppEnv>()
  .post("/payments/notices", async (c) => {
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
  })

  // The statement's credits for a period. The same import again changes nothing and
  // answers the same findings.
  .post("/payments/statements", async (c) => {
    const statement = await jsonBody(c, statementImportRequest);
    const rawSha256 = await sha256(JSON.stringify(statement));
    const body = await c.var.db.transaction(await userActor(c, "admin"), async (tx) => {
      const [imported] = await tx<{ id: string }[]>`
        SELECT payments.import_statement(${statement.from}::date, ${statement.to}::date,
                 ${tx.json(statement.lines)}, ${rawSha256}) AS id`;
      if (!imported) throw new Error("payments.import_statement returned nothing");
      const rows = await tx<
        {
          order_code: string;
          reference: string;
          amount_crc: number;
          paid_on: string;
          finding: Finding["finding"];
        }[]
      >`SELECT order_code, reference, amount_crc, paid_on::text AS paid_on, finding
          FROM payments.statement_findings(${imported.id})`;
      const response: StatementImportResponse = {
        statementId: imported.id,
        findings: rows.map((row) => ({
          orderCode: row.order_code,
          reference: row.reference,
          amountCrc: row.amount_crc,
          paidOn: row.paid_on,
          finding: row.finding,
        })),
      };
      return response;
    });
    c.header("Cache-Control", "no-store");
    return c.json(body);
  });

// Municipal accounts (Phase 8): who may authorize, watch and declare for a canton. Granting
// creates the account when the email has none yet, so the person can sign in with a code.
adminRoutes
  .post("/inspectors", async (c) => {
    const input = await jsonBody(c, grantInspectorRequest);
    const userId = await c.var.db.transaction(await userActor(c, "admin"), async (tx) => {
      const [row] = await tx<{ id: string }[]>`
        SELECT identity.grant_inspector(${input.email}, ${input.cantonCode}, ${input.kind}) AS id`;
      if (!row) throw new Error("identity.grant_inspector returned nothing");
      return row.id;
    });
    return c.json({ userId }, 201);
  })
  .post("/inspectors/revoke", async (c) => {
    const input = await jsonBody(c, revokeInspectorRequest);
    await c.var.db.transaction(await userActor(c, "admin"), async (tx) => {
      await tx`SELECT identity.revoke_inspector(${input.userId}, ${input.cantonCode})`;
    });
    return c.body(null, 204);
  });
