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
});
export type RecoveryVerifyResponse = z.infer<typeof recoveryVerifyResponse>;
