// Wire format of the buyer's wallet (design 6.2, 6.6, ADR 0030, 0032, 0036). The order's
// token travels as `Authorization: Bearer`. Certificates are signed again on every read
// (Ed25519 is deterministic, ADR 0016) and travel as base64url; the wallet presents them
// with its device key.

import { z } from "zod";
import { buyerContact, ORDER_STATUSES } from "./checkout-api.ts";

const isoTime = z.iso.datetime({ offset: true });
const base64url = z.string().regex(/^[A-Za-z0-9_-]*$/);

/** POST /v1/wallet/bind: the device's Ed25519 public key, 32 bytes in base64url. */
export const bindRequest = z.object({ publicKey: base64url.length(43) });
export type BindRequest = z.infer<typeof bindRequest>;

export const WALLET_TICKET_STATUSES = ["issued", "bound", "void"] as const;

export const walletTicket = z.object({
  id: z.uuid(),
  typeName: z.string(),
  /** The fallback code, as shown: 4K7NP-9XR2M. */
  humanCode: z.string(),
  status: z.enum(WALLET_TICKET_STATUSES),
  keyVersion: z.int().nonnegative(),
  /** The device key the ticket is bound to, so the wallet knows whether it is this one. */
  holderKey: base64url.nullable(),
  /** The server's certificate (126 bytes) for a bound ticket. */
  certificate: base64url.nullable(),
  /** Whether the ticket was ever transferred: then it belongs to its receiver (6.6). */
  transferred: z.boolean(),
  /** Whether the event's tickets carry their attendee (design 7.1). */
  named: z.boolean(),
  /** The attendee, once assigned; the document only by its last digits. */
  attendee: z
    .object({
      fullName: z.string(),
      docType: z.enum(["cedula", "dimex", "pasaporte", "tim"]),
      docLast4: z.string(),
    })
    .nullable(),
});
export type WalletTicket = z.infer<typeof walletTicket>;

/** GET /v1/wallet and the answer of POST /v1/wallet/bind. */
export const walletView = z.object({
  order: z.object({
    orderCode: z.string(),
    status: z.enum(ORDER_STATUSES),
    amountCrc: z.int().nonnegative(),
    expiresAt: isoTime,
  }),
  event: z
    .object({
      id: z.uuid(),
      name: z.string(),
      venueName: z.string(),
      startsAt: isoTime,
    })
    .nullable(),
  /** The server keys a certificate may be checked against. */
  serverKeys: z.array(z.object({ id: z.int().min(0).max(255), publicKey: base64url })),
  tickets: z.array(walletTicket),
  /** Tickets this request could not bind because another device holds them. */
  boundElsewhere: z.int().nonnegative(),
});
export type WalletView = z.infer<typeof walletView>;

/** POST /v1/wallet/recovery: a code to the order's contact (ADR 0036). */
export const recoveryRequest = z.object({ contact: buyerContact });
export type RecoveryRequest = z.input<typeof recoveryRequest>;

/** POST /v1/wallet/recovery/verify. */
export const recoveryVerifyRequest = z.object({
  contact: buyerContact,
  code: z
    .string()
    .trim()
    .regex(/^[0-9]{6}$/),
});
export type RecoveryVerifyRequest = z.input<typeof recoveryVerifyRequest>;

export const recoveryVerifyResponse = z.object({
  /** One new token per order of that contact; each may rebind its tickets to this device. */
  orders: z.array(z.object({ orderCode: z.string(), token: z.string() })),
  /**
   * One new receiver token per ticket received with that email and still held; each may
   * move its ticket to this device once, within an hour, through POST /v1/transfers/held/bind.
   */
  held: z.array(z.object({ eventName: z.string(), token: z.string() })),
});
export type RecoveryVerifyResponse = z.infer<typeof recoveryVerifyResponse>;

// ── Right of access (design 14.7) ────────────────────────────────────────────
// POST /v1/wallet/export asks for a code to the email (same body as recovery); POST
// /v1/wallet/export/verify with the code answers everything kept about that address. A
// ticket the buyer gave away stops at the transfer: what came after is the receiver's.

export const BUYER_EXPORT_FORMAT = "passripple.buyer-export/v1";

export const EXPORT_TICKET_STATUSES = ["unsold", "issued", "bound", "void", "transferred"] as const;

const exportTicket = z.object({
  typeName: z.string(),
  /** The fallback code, as shown; null for a ticket given away. */
  humanCode: z.string().nullable(),
  status: z.enum(EXPORT_TICKET_STATUSES),
  entryMode: z.enum(["single_use", "multi_scan"]),
  issuedAt: isoTime,
  transferredAt: isoTime.nullable(),
  bindings: z.array(
    z.object({ reason: z.enum(["bind", "transfer", "recovery"]), boundAt: isoTime }),
  ),
  transferOffers: z.array(
    z.object({
      createdAt: isoTime,
      expiresAt: isoTime,
      cancelledAt: isoTime.nullable(),
      claimedAt: isoTime.nullable(),
    }),
  ),
});

export const buyerExport = z.object({
  format: z.literal(BUYER_EXPORT_FORMAT),
  generatedAt: isoTime,
  contact: z.object({ email: z.string() }),
  orders: z.array(
    z.object({
      orderCode: z.string(),
      status: z.enum(ORDER_STATUSES),
      amountCrc: z.int().nonnegative(),
      contactPhone: z.string().nullable(),
      createdAt: isoTime,
      paidAt: isoTime.nullable(),
      expiresAt: isoTime,
      event: z.object({ name: z.string(), venueName: z.string(), startsAt: isoTime }),
      items: z.array(
        z.object({
          typeName: z.string(),
          quantity: z.int().positive(),
          unitPriceCrc: z.int().nonnegative(),
          unitFeeCrc: z.int().nonnegative(),
          unitFeeTaxCrc: z.int().nonnegative(),
        }),
      ),
      tickets: z.array(exportTicket),
      consents: z.array(
        z.object({
          purpose: z.string(),
          granted: z.boolean(),
          documentVersion: z.string(),
          source: z.string(),
          recordedAt: isoTime,
        }),
      ),
    }),
  ),
  contactCodes: z.array(
    z.object({
      purpose: z.enum(["recovery", "erasure", "export"]),
      requestedAt: isoTime,
      usedAt: isoTime.nullable(),
    }),
  ),
  /** Tickets received by transfer with this email; each stops when it was passed on. */
  received: z.array(
    z.object({
      event: z.object({ name: z.string(), venueName: z.string(), startsAt: isoTime }),
      typeName: z.string(),
      claimedAt: isoTime,
      status: z.enum(EXPORT_TICKET_STATUSES),
    }),
  ),
});
export type BuyerExport = z.infer<typeof buyerExport>;

/**
 * GET and POST /v1/wallet/preferences with the order's token: the news choice of the
 * person behind the order, for all their orders. null when nothing was ever recorded.
 */
export const walletPreferences = z.object({ marketing: z.boolean().nullable() });
export type WalletPreferences = z.infer<typeof walletPreferences>;

/** POST /v1/wallet/preferences. */
export const walletPreferencesRequest = z.object({ marketing: z.boolean() });
export type WalletPreferencesRequest = z.infer<typeof walletPreferencesRequest>;

// ── Transfers (design 6.6) ───────────────────────────────────────────────────
// The holder offers one ticket; the link carries the offer's secret after `#`, so it never
// reaches a server log. Whoever claims it binds the ticket to their own device and gets a
// token that reaches that ticket only.

/** Prefix of a receiver's token: it reaches one transferred ticket. */
export const HELD_TOKEN_PREFIX = "prh_";
/** Prefix of a transfer offer's secret, the part of the link after `#`. */
export const OFFER_TOKEN_PREFIX = "prx_";

const token = (prefix: string) => z.string().startsWith(prefix).max(128);

/**
 * POST /v1/transfers and POST /v1/transfers/cancel, with the order's or the receiver's
 * token: the holder's signature over the ticket, its key version and the time.
 */
export const transferProof = z.object({
  ticketId: z.uuid(),
  publicKey: base64url.length(43),
  /** Unix time in whole seconds, as signed. */
  issuedAt: z.int().nonnegative(),
  signature: base64url.length(86),
});
export type TransferProof = z.infer<typeof transferProof>;

export const ATTENDEE_DOC_TYPES = ["cedula", "dimex", "pasaporte", "tim"] as const;
export type AttendeeDocType = (typeof ATTENDEE_DOC_TYPES)[number];

/**
 * POST /v1/attendees: the holder names who will use a ticket of a named event (design 7.3),
 * signed like a transfer. The document number never comes back.
 */
export const attendeeRequest = transferProof.extend({
  fullName: z.string().trim().min(2).max(120),
  docType: z.enum(ATTENDEE_DOC_TYPES),
  docNumber: z.string().min(1).max(40),
});
export type AttendeeRequest = z.infer<typeof attendeeRequest>;

/** A ticket's attendee as the wallet shows it. */
export const attendeeView = z.object({
  ticketId: z.uuid(),
  fullName: z.string(),
  docType: z.enum(ATTENDEE_DOC_TYPES),
  /** The last digits of the document, what the gate shows. */
  docLast4: z.string(),
});
export type AttendeeView = z.infer<typeof attendeeView>;

export const transferOffered = z.object({
  offerToken: token(OFFER_TOKEN_PREFIX),
  expiresAt: isoTime,
});
export type TransferOffered = z.infer<typeof transferOffered>;

export const TRANSFER_OFFER_STATES = ["open", "claimed", "cancelled", "expired"] as const;

/** POST /v1/transfers/preview and /v1/transfers/claim: the offer's secret. */
export const offerRequest = z.object({ offerToken: token(OFFER_TOKEN_PREFIX) });
export type OfferRequest = z.infer<typeof offerRequest>;

/** What the receiver sees before claiming. */
export const transferPreview = z.object({
  eventName: z.string(),
  venueName: z.string(),
  startsAt: isoTime,
  typeName: z.string(),
  expiresAt: isoTime,
  state: z.enum(TRANSFER_OFFER_STATES),
});
export type TransferPreview = z.infer<typeof transferPreview>;

/**
 * The receiver's device key and, optionally, an email: with it they can recover the ticket
 * on a new phone, download their data and have it erased, like a buyer.
 */
export const claimRequest = offerRequest.extend({
  publicKey: base64url.length(43),
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)).optional(),
});
export type ClaimRequest = z.infer<typeof claimRequest>;

export const claimResponse = z.object({ token: token(HELD_TOKEN_PREFIX) });
export type ClaimResponse = z.infer<typeof claimResponse>;

/** GET /v1/transfers/held, with the receiver's token. */
export const heldView = walletView.pick({ event: true, serverKeys: true }).extend({
  ticket: walletTicket,
});
export type HeldView = z.infer<typeof heldView>;

/** POST /v1/transfers/held/bind, with a recovered receiver token: the new device's key. */
export const heldBindRequest = z.object({ publicKey: base64url.length(43) });
export type HeldBindRequest = z.infer<typeof heldBindRequest>;
