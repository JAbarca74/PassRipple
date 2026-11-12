// Municipal oversight (Phase 8, design 12): the authorization of an event's emission, the live
// count, inspector mode and the declaration. The platform prepares the data; the organizer
// declares and pays the tax, and the money never passes through the platform.

import { z } from "zod";

const time = z.iso.datetime({ offset: true });
const count = z.int().nonnegative();

export const MUNICIPAL_KINDS = ["official", "inspector"] as const;
export type MunicipalKind = (typeof MUNICIPAL_KINDS)[number];

/** A canton code, as the administrator types it (jurisdictions.canton_code). */
export const cantonCode = z
  .string()
  .max(32)
  .regex(/^[0-9A-Za-z][0-9A-Za-z_-]*$/);

/** POST /v1/admin/inspectors: grants municipal access to the person with this email. */
export const grantInspectorRequest = z.object({
  email: z.email().max(254),
  cantonCode,
  kind: z.enum(MUNICIPAL_KINDS),
});
export type GrantInspectorRequest = z.infer<typeof grantInspectorRequest>;

/** POST /v1/admin/inspectors/revoke */
export const revokeInspectorRequest = z.object({ userId: z.uuid(), cantonCode });
export type RevokeInspectorRequest = z.infer<typeof revokeInspectorRequest>;

/**
 * POST /v1/municipal/authorizations (organizer). `portal`: the municipality decides in the
 * portal. `document`: the organizer records the reference of the authorization from the
 * canton's usual process, where the canton has no portal.
 */
export const requestAuthorizationRequest = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("portal"), eventId: z.uuid() }),
  z.object({
    mode: z.literal("document"),
    eventId: z.uuid(),
    reference: z.string().trim().min(1).max(100),
  }),
]);
export type RequestAuthorizationRequest = z.infer<typeof requestAuthorizationRequest>;

/** POST /v1/municipal/authorizations/:id/decision (official). */
export const decideAuthorizationRequest = z.object({
  approve: z.boolean(),
  notes: z.string().trim().max(500).optional(),
});
export type DecideAuthorizationRequest = z.infer<typeof decideAuthorizationRequest>;

/** POST /v1/municipal/verify (inspector): a ticket's human code, as printed or typed. */
export const verifyTicketRequest = z.object({ code: z.string().trim().min(4).max(40) });
export type VerifyTicketRequest = z.infer<typeof verifyTicketRequest>;

export const AUTHORIZATION_STATUSES = ["requested", "authorized", "rejected"] as const;

export const authorizationItem = z.object({
  authorizationId: z.uuid(),
  eventId: z.uuid(),
  eventName: z.string(),
  organization: z.string(),
  cantonCode: z.string(),
  startsAt: time,
  permitNumber: z.string().nullable(),
  permittedCapacity: count,
  mode: z.enum(["portal", "document"]),
  status: z.enum(AUTHORIZATION_STATUSES),
  reference: z.string().nullable(),
  notes: z.string().nullable(),
  requestedAt: time,
  decidedAt: time.nullable(),
  /** The most tax the authorized emission could produce, in colones. */
  estimatedTaxCrc: count,
  guaranteeCrc: count.nullable(),
});
export type AuthorizationItem = z.infer<typeof authorizationItem>;

/** GET /v1/municipal/authorizations */
export const authorizationsResponse = z.object({ authorizations: z.array(authorizationItem) });
export type AuthorizationsResponse = z.infer<typeof authorizationsResponse>;

/** The live count of an event (12.2): always read from the domain, never a stored figure. */
export const liveCounts = z.object({
  capacity: count,
  issued: count,
  soldOnline: count,
  doorSales: count,
  courtesies: count,
  redeemed: count,
  voided: count,
});
export type LiveCounts = z.infer<typeof liveCounts>;

export const municipalEvent = z.object({
  eventId: z.uuid(),
  name: z.string(),
  organization: z.string(),
  cantonCode: z.string(),
  startsAt: time,
  endsAt: time,
  status: z.string(),
  emissionAuth: z.string().nullable(),
  counts: liveCounts,
});
export type MunicipalEvent = z.infer<typeof municipalEvent>;

/** GET /v1/municipal/events */
export const municipalEventsResponse = z.object({ events: z.array(municipalEvent) });
export type MunicipalEventsResponse = z.infer<typeof municipalEventsResponse>;

/** GET /v1/municipal/events/:id/courtesy: the alert of the deductible courtesies. */
export const courtesyDeductible = z.object({
  courtesies: count,
  /** Tickets issued, the base of the canton's share. */
  entries: count,
  /** The canton's deductible share in basis points; null when its rules set none. */
  deductBps: count.nullable(),
  limit: count.nullable(),
  /** Courtesies above the limit, which are taxed as sales. */
  excess: count,
});
export type CourtesyDeductible = z.infer<typeof courtesyDeductible>;

/** POST /v1/municipal/verify: inspector mode checks a ticket without admitting it. */
export const verifyTicketResponse = z.object({
  valid: z.boolean(),
  reason: z.enum(["ok", "void", "unsold", "already_admitted", "unknown"]),
  eventId: z.uuid().optional(),
  eventName: z.string().optional(),
  ticketType: z.string().optional(),
  origin: z.string().optional(),
  admitted: z.boolean().optional(),
});
export type VerifyTicketResponse = z.infer<typeof verifyTicketResponse>;

/** One ticket type's figures in the declaration. */
export const declarationType = z.object({
  name: z.string(),
  priceCrc: count,
  audience: z.string(),
  online: count,
  door: count,
  courtesies: count,
  redeemed: count,
  voided: count,
});
export type DeclarationType = z.infer<typeof declarationType>;

export const cantonRules = z.object({
  taxRateBps: count,
  /** Deductible share per ticket category, in basis points. */
  courtesyDeductBps: z.record(z.string(), count),
  settlementRule: z.string(),
  guaranteeBps: count.nullable(),
  reportFormat: z.string(),
});
export type CantonRules = z.infer<typeof cantonRules>;

/** What the database knows about the event, before any tax is calculated (12.4). */
export const declarationFigures = z.object({
  event: z.object({
    id: z.uuid(),
    name: z.string(),
    venue: z.string(),
    startsAt: time,
    endsAt: time,
    permitNumber: z.string().nullable(),
    emissionAuth: z.string().nullable(),
    status: z.string(),
    permittedCapacity: count,
  }),
  organization: z.string(),
  canton: z.object({ code: z.string(), name: z.string() }),
  rules: cantonRules,
  types: z.array(declarationType),
  duplicateScans: count,
  capacityIncidents: count,
  courtesy: courtesyDeductible,
  /** sha256 of every ticket and every admission of the event, in a fixed order. */
  logHash: z.string().regex(/^[0-9a-f]{64}$/),
  generatedAt: time,
});
export type DeclarationFigures = z.infer<typeof declarationFigures>;

/** The declaration: the figures plus what the tax package calculated from them. */
export const declaration = z.object({
  figures: declarationFigures,
  grossCrc: count,
  /** Courtesies above the limit, valued at the average paid price. */
  courtesyExcessCrc: count,
  taxableBaseCrc: count,
  taxCrc: count,
  /** The day the organizer settles with the municipality (YYYY-MM-DD); null when the rule is unknown. */
  dueDate: z.string().nullable(),
});
export type Declaration = z.infer<typeof declaration>;
