// Complimentary tickets granted online (design I3, 6.6). The organizer declares the event's
// quota and grants against it; each ticket comes back as a private link, like a transfer's,
// that the organizer sends to its receiver. One transaction: the organizer's grant counts
// against the quota (courtesy), then as the system the seats are taken (inventory, I2), the
// tickets issued and their links opened (ticketing). Nothing is left half granted.

import {
  courtesyQuotaRequest,
  type GrantedCourtesy,
  grantCourtesyRequest,
  OFFER_TOKEN_PREFIX,
} from "@passripple/contracts";
import { HUMAN_CODE_ENTROPY_BYTES, humanCode } from "@passripple/crypto";
import { Hono } from "hono";
import type { AppEnv } from "../app.ts";
import { userActor } from "../auth.ts";
import { ApiError } from "../errors.ts";
import { newToken } from "../secrets.ts";
import { isoRequired, jsonBody } from "../validation.ts";

/** How long a courtesy link stays open, unless the event starts first. */
const LINK_TTL_DAYS = 14;

export const courtesyRoutes = new Hono<AppEnv>()
  .post("/quota", async (c) => {
    const input = await jsonBody(c, courtesyQuotaRequest);
    await c.var.db.transaction(await userActor(c, "organizer"), async (tx) => {
      await tx`SELECT courtesy.declare_quota(${input.eventId}, ${input.quota})`;
    });
    return c.body(null, 204);
  })

  .post("/", async (c) => {
    const input = await jsonBody(c, grantCourtesyRequest);
    const tokens = Array.from({ length: input.quantity }, () => newToken(OFFER_TOKEN_PREFIX));
    const body = await c.var.db.transaction(
      await userActor(c, "organizer"),
      async (tx): Promise<GrantedCourtesy> => {
        const [grant] = await tx<{ id: string | null }[]>`
          SELECT courtesy.grant_tickets(${input.eventId}, ${input.quantity}) AS id`;
        if (!grant?.id) {
          throw new ApiError(409, "quota_exceeded", "The event's courtesy quota has no room left.");
        }
        // From here on the platform acts: the organizer's part is done and checked.
        await tx`SELECT identity.set_actor(NULL, 'system', NULL)`;
        const [seats] = await tx<{ ok: boolean }[]>`
          SELECT inventory.commit_courtesy(${input.eventId}, ${input.ticketTypeId},
                                           ${input.quantity}) AS ok`;
        if (!seats?.ok) throw new ApiError(409, "sold_out", "There are not enough seats left.");
        const links: GrantedCourtesy["links"] = [];
        for (const offerToken of tokens) {
          const code = humanCode(crypto.getRandomValues(new Uint8Array(HUMAN_CODE_ENTROPY_BYTES)));
          const [issued] = await tx<{ id: string }[]>`
            SELECT ticketing.issue(${input.eventId}, ${input.ticketTypeId}, NULL, 'courtesy',
                                   ${code}) AS id`;
          if (!issued) throw new Error("ticketing.issue returned nothing");
          const [offered] = await tx<{ expires_at: Date }[]>`
            SELECT ticketing.offer_courtesy(${issued.id}, ${offerToken},
                                            make_interval(days => ${LINK_TTL_DAYS})) AS expires_at`;
          if (!offered) throw new Error("ticketing.offer_courtesy returned nothing");
          links.push({
            ticketId: issued.id,
            offerToken,
            expiresAt: isoRequired(offered.expires_at),
          });
        }
        return { grantId: grant.id, links };
      },
    );
    c.header("Cache-Control", "no-store");
    return c.json(body, 201);
  });
