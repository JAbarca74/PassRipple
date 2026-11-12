// Contact codes for buyers (ADR 0036): asking for one and checking it, shared by recovery
// and erasure. Asking answers the same whether or not the address has orders. Checking
// counts the attempt in its own transaction before comparing, in constant time, so a wrong
// code always spends an attempt.

import type { Context } from "hono";
import type { AppEnv } from "../app.ts";
import { SYSTEM_ACTOR } from "../db.ts";
import { required } from "../env.ts";
import { ApiError } from "../errors.ts";
import { type ContactPurpose, emailChannel } from "../ports/contact.ts";
import { contactCodeHash, newSignInCode, sameHash } from "../secrets.ts";

export const CONTACT_CODE_TTL_SECONDS = 600;

/** Draws a code, records it and, if the address has orders, mails it. */
export async function sendContactCode(
  c: Context<AppEnv>,
  email: string,
  purpose: ContactPurpose,
): Promise<void> {
  const code = newSignInCode();
  const hash = await contactCodeHash(required(c.env, "SIGN_IN_PEPPER"), purpose, email, code);
  const hasOrders = await c.var.db.transaction(SYSTEM_ACTOR, async (tx) => {
    const [row] = await tx<{ has_orders: boolean }[]>`
      SELECT orders.request_contact_code(${email}, ${purpose}, ${hash},
                                         make_interval(secs => ${CONTACT_CODE_TTL_SECONDS})) AS has_orders`;
    return row?.has_orders ?? false;
  });
  if (hasOrders) await emailChannel(c.var.mailer()).send(email, code, purpose);
}

/**
 * Checks a typed code and uses it up. Returns its id, or throws 401 when it is wrong, spent
 * or expired: the attempt is already counted.
 */
export async function checkContactCode(
  c: Context<AppEnv>,
  email: string,
  purpose: ContactPurpose,
  code: string,
): Promise<string> {
  const typed = await contactCodeHash(required(c.env, "SIGN_IN_PEPPER"), purpose, email, code);
  const challenge = await c.var.db.transaction(SYSTEM_ACTOR, async (tx) => {
    const [row] = await tx<{ code_id: string; code_hash: Uint8Array }[]>`
      SELECT * FROM orders.contact_code_challenge(${email}, ${purpose})`;
    return row;
  });
  const wrong = () => new ApiError(401, "invalid_code", "The code is wrong, used or expired.");
  if (!challenge || !sameHash(typed, new Uint8Array(challenge.code_hash))) throw wrong();
  return challenge.code_id;
}
