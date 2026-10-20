// A buyer's data erasure (design 14.7, ADR 0037), from the public /eliminar-datos page. The
// buyer has no account: they prove the order's email with a code, as in recovery. orders
// erases what it holds; nothing else of the buyer is personal (consents name the order, the
// ledger holds no contact). While the address has an order pending or a paid ticket for an
// event still to come, erasure answers 409 with those orders, so nobody loses a paid ticket
// without knowing; the buyer can come back after the event.

import { recoveryRequest, recoveryVerifyRequest } from "@passripple/contracts";
import { Hono } from "hono";
import type { AppEnv } from "../app.ts";
import { SYSTEM_ACTOR } from "../db.ts";
import { ApiError } from "../errors.ts";
import { emailOf } from "../ports/contact.ts";
import { isoRequired, jsonBody } from "../validation.ts";
import { CONTACT_CODE_TTL_SECONDS, checkContactCode, sendContactCode } from "./contact-codes.ts";

interface BlockerRow {
  pay_code: string;
  status: string;
  event_name: string;
  ends_at: Date;
}

export const buyerRoutes = new Hono<AppEnv>()
  .post("/erasure/code", async (c) => {
    const { contact } = await jsonBody(c, recoveryRequest);
    await sendContactCode(c, emailOf(contact), "erasure");
    return c.json({ expiresInSeconds: CONTACT_CODE_TTL_SECONDS }, 202);
  })

  .post("/erasure", async (c) => {
    const { contact, code } = await jsonBody(c, recoveryVerifyRequest);
    const email = emailOf(contact);
    const codeId = await checkContactCode(c, email, "erasure", code);
    const outcome = await c.var.db.transaction(SYSTEM_ACTOR, async (tx) => {
      const blockers = await tx<BlockerRow[]>`SELECT * FROM orders.erasure_blockers(${codeId})`;
      if (blockers.length > 0) return { blockers, erased: 0 };
      const [used] = await tx<
        { used: boolean }[]
      >`SELECT orders.use_contact_code(${codeId}) AS used`;
      if (!used?.used)
        throw new ApiError(401, "invalid_code", "The code is wrong, used or expired.");
      const [row] = await tx<{ erased: number }[]>`SELECT orders.erase_buyer(${codeId}) AS erased`;
      return { blockers: [], erased: row?.erased ?? 0 };
    });
    if (outcome.blockers.length > 0) {
      return c.json(
        {
          error: {
            code: "open_orders",
            message: "Some orders are still open or have tickets for events to come.",
          },
          orders: outcome.blockers.map((row) => ({
            orderCode: row.pay_code,
            status: row.status,
            eventName: row.event_name,
            endsAt: isoRequired(row.ends_at),
          })),
        },
        409,
      );
    }
    return c.json({ erasedOrders: outcome.erased });
  });
