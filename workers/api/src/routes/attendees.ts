// Attendees of named tickets (design 7.3): the phone holding a ticket names who will use it,
// until the event starts. Signed like a transfer, so a forwarded order link is not enough.
// The document number is checked, encrypted with ATTENDEE_DOC_KEY and stored; only its last
// digits ever come back.

import { type AttendeeView, attendeeRequest, HELD_TOKEN_PREFIX } from "@passripple/contracts";
import { Hono } from "hono";
import type { AppEnv } from "../app.ts";
import { docLast4, importDocKey, normalizeDocNumber, sealDocNumber } from "../attendee-doc.ts";
import { SYSTEM_ACTOR } from "../db.ts";
import { required } from "../env.ts";
import { ApiError } from "../errors.ts";
import { jsonBody } from "../validation.ts";
import { holderToken, provenHolder } from "./transfers.ts";

export const attendeeRoutes = new Hono<AppEnv>().post("/", async (c) => {
  const input = await jsonBody(c, attendeeRequest);
  const number = normalizeDocNumber(input.docType, input.docNumber);
  if (number === null) {
    throw new ApiError(400, "invalid_document", "This document number does not look valid.");
  }
  const key = await importDocKey(required(c.env, "ATTENDEE_DOC_KEY"));
  const assignedBy = holderToken(c).startsWith(HELD_TOKEN_PREFIX) ? "receiver" : "buyer";

  const body = await c.var.db.transaction(SYSTEM_ACTOR, async (tx): Promise<AttendeeView> => {
    const { row, publicKey } = await provenHolder(c, tx, input);
    const sealed = await sealDocNumber(key, row.ticket_id, number);
    await tx`
      SELECT ticketing.assign_attendee(${row.ticket_id}, ${publicKey}, ${input.fullName},
                                       ${input.docType}, ${docLast4(number)}, ${sealed},
                                       ${assignedBy})`;
    return {
      ticketId: row.ticket_id,
      fullName: input.fullName,
      docType: input.docType,
      docLast4: docLast4(number),
    };
  });
  c.header("Cache-Control", "no-store");
  return c.json(body, 201);
});
