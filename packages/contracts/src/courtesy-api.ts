// Complimentary tickets (design I3): the organizer declares how many the event may give and
// grants them online; each ticket gets a private link, like a transfer's, that its receiver
// opens to keep it on their own phone.

import { z } from "zod";

const isoTime = z.iso.datetime({ offset: true });

/** POST /v1/courtesies/quota: how many complimentary tickets the event may give. */
export const courtesyQuotaRequest = z.object({
  eventId: z.uuid(),
  quota: z.int().min(0).max(100_000),
});
export type CourtesyQuotaRequest = z.infer<typeof courtesyQuotaRequest>;

/** POST /v1/courtesies: grants complimentary tickets of one type. */
export const grantCourtesyRequest = z.object({
  eventId: z.uuid(),
  ticketTypeId: z.uuid(),
  quantity: z.int().min(1).max(20),
});
export type GrantCourtesyRequest = z.infer<typeof grantCourtesyRequest>;

/** One link per ticket: the secret goes after `#` in the app's /recibir page. */
export const grantedCourtesy = z.object({
  grantId: z.uuid(),
  links: z.array(
    z.object({ ticketId: z.uuid(), offerToken: z.string().startsWith("prx_"), expiresAt: isoTime }),
  ),
});
export type GrantedCourtesy = z.infer<typeof grantedCourtesy>;
