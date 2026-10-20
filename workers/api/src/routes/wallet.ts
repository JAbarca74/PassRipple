// The buyer's wallet (design 6.2, 6.6, ADR 0030, 0032, 0035). The order's token is checked
// and the order's tickets read in one statement (orders.wallet_tickets), so a token never
// reaches another order. Binding ties every unbound ticket of the order to the device's key;
// a ticket bound to another device is rebound only with a recovery token. Certificates are
// signed on every read with the server key from the Worker's secrets.

import {
  bindRequest,
  decodeBase64url,
  encodeBase64url,
  encodeCertificate,
  type OrderStatus,
  type RecoveryVerifyResponse,
  recoveryRequest,
  recoveryVerifyRequest,
  ORDER_TOKEN_PREFIX as TOKEN_PREFIX,
  type WalletTicket,
  type WalletView,
} from "@passripple/contracts";
import {
  formatHumanCode,
  isAcceptableHolderKey,
  type ServerSigner,
  signCertificate,
} from "@passripple/crypto";
import { type Context, Hono } from "hono";
import type { AppEnv } from "../app.ts";
import { bearer } from "../auth.ts";
import { SYSTEM_ACTOR, type Tx } from "../db.ts";
import { ApiError } from "../errors.ts";
import { emailOf } from "../ports/contact.ts";
import { newToken } from "../secrets.ts";
import { serverKeys, serverSigner } from "../server-keys.ts";
import { isoRequired, jsonBody } from "../validation.ts";
import { CONTACT_CODE_TTL_SECONDS, checkContactCode, sendContactCode } from "./contact-codes.ts";

interface AccessRow {
  order_id: string;
  status: OrderStatus;
  pay_code: string;
  amount_crc: number;
  expires_at: Date;
  can_rebind: boolean;
}

interface TicketRow {
  ticket_id: string;
  event_id: string;
  event_name: string;
  venue_name: string;
  starts_at: Date;
  age_rating: "all" | "12plus" | "18plus";
  type_name: string;
  type_ref: number;
  entry_mode: "single_use" | "multi_scan";
  status: "unsold" | "issued" | "bound" | "void";
  holder_pubkey: Uint8Array | null;
  key_version: number;
  code_human: string;
}

const UNAUTHORIZED = () => new ApiError(401, "unauthorized", "This order link is not valid.");

/** The token's order, or 401. */
export async function walletAccess(tx: Tx, token: string): Promise<AccessRow> {
  const [access] = await tx<AccessRow[]>`SELECT * FROM orders.wallet_access(${token})`;
  if (!access) throw UNAUTHORIZED();
  return access;
}

function walletTickets(tx: Tx, token: string): Promise<TicketRow[]> {
  return tx<TicketRow[]>`SELECT * FROM orders.wallet_tickets(${token})`;
}

function sameKey(a: Uint8Array | null, b: Uint8Array): boolean {
  if (a === null || a.length !== b.length) return false;
  return a.every((byte, index) => byte === b[index]);
}

async function ticketView(row: TicketRow, signer: ServerSigner | null): Promise<WalletTicket> {
  let certificate: string | null = null;
  if (row.status === "bound" && row.holder_pubkey !== null && signer !== null) {
    const signed = await signCertificate(
      {
        ticketId: row.ticket_id,
        eventId: row.event_id,
        typeRef: row.type_ref,
        entryMode: row.entry_mode,
        ageRating: row.age_rating,
        // Named tickets arrive in Phase 7.
        named: false,
        holderPubkey: new Uint8Array(row.holder_pubkey),
        keyVersion: row.key_version,
      },
      signer,
    );
    certificate = encodeBase64url(encodeCertificate(signed));
  }
  return {
    id: row.ticket_id,
    typeName: row.type_name,
    humanCode: formatHumanCode(row.code_human),
    status: row.status === "unsold" ? "issued" : row.status,
    keyVersion: row.key_version,
    holderKey:
      row.holder_pubkey === null ? null : encodeBase64url(new Uint8Array(row.holder_pubkey)),
    certificate,
  };
}

async function view(
  c: Context<AppEnv>,
  access: AccessRow,
  rows: TicketRow[],
  boundElsewhere: number,
): Promise<WalletView> {
  const signer = rows.some((row) => row.status === "bound") ? await serverSigner(c.env) : null;
  const first = rows[0];
  return {
    order: {
      orderCode: access.pay_code,
      status: access.status,
      amountCrc: access.amount_crc,
      expiresAt: isoRequired(access.expires_at),
    },
    event: first
      ? {
          id: first.event_id,
          name: first.event_name,
          venueName: first.venue_name,
          startsAt: isoRequired(first.starts_at),
        }
      : null,
    serverKeys: serverKeys(c.env).map((key) => ({
      id: key.id,
      publicKey: encodeBase64url(key.publicKey),
    })),
    tickets: await Promise.all(rows.map((row) => ticketView(row, signer))),
    boundElsewhere,
  };
}

export const walletRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const token = bearer(c, TOKEN_PREFIX);
    const { access, rows } = await c.var.db.transaction(SYSTEM_ACTOR, async (tx) => ({
      access: await walletAccess(tx, token),
      rows: await walletTickets(tx, token),
    }));
    c.header("Cache-Control", "no-store");
    return c.json(await view(c, access, rows, 0));
  })

  // Ties the order's tickets to this device's key (ADR 0032).
  .post("/bind", async (c) => {
    const token = bearer(c, TOKEN_PREFIX);
    const { publicKey } = await jsonBody(c, bindRequest);
    const key = decodeBase64url(publicKey);
    if (key === null || key.length !== 32 || !isAcceptableHolderKey(key)) {
      throw new ApiError(400, "invalid_key", "This device key cannot hold tickets.");
    }
    const result = await c.var.db.transaction(SYSTEM_ACTOR, async (tx) => {
      const access = await walletAccess(tx, token);
      if (access.status !== "paid") {
        throw new ApiError(409, "not_paid", "The order is not paid yet.");
      }
      let boundElsewhere = 0;
      let rebound = false;
      for (const row of await walletTickets(tx, token)) {
        if (row.status === "issued") {
          await tx`SELECT ticketing.bind(${row.ticket_id}, ${key}, 'bind')`;
        } else if (row.status === "bound" && !sameKey(row.holder_pubkey, key)) {
          if (access.can_rebind) {
            await tx`SELECT ticketing.bind(${row.ticket_id}, ${key}, 'recovery')`;
            rebound = true;
          } else {
            boundElsewhere++;
          }
        }
      }
      // A recovery token rebinds once: a second device with the same token cannot.
      if (rebound) await tx`SELECT orders.consume_rebind(${token})`;
      return { access, rows: await walletTickets(tx, token), boundElsewhere };
    });
    c.header("Cache-Control", "no-store");
    return c.json(await view(c, result.access, result.rows, result.boundElsewhere));
  })

  // Recovery on a new device (6.6, ADR 0036): a code to the order's email.
  .post("/recovery", async (c) => {
    const { contact } = await jsonBody(c, recoveryRequest);
    await sendContactCode(c, emailOf(contact), "recovery");
    return c.json({ expiresInSeconds: CONTACT_CODE_TTL_SECONDS }, 202);
  })

  // The code matched: one new token per paid order of that email. Each may rebind its
  // order's tickets to this device once, within an hour, through POST /wallet/bind.
  .post("/recovery/verify", async (c) => {
    const { contact, code } = await jsonBody(c, recoveryVerifyRequest);
    const email = emailOf(contact);
    const codeId = await checkContactCode(c, email, "recovery", code);
    const body = await c.var.db.transaction(SYSTEM_ACTOR, async (tx) => {
      const [used] = await tx<
        { used: boolean }[]
      >`SELECT orders.use_contact_code(${codeId}) AS used`;
      if (!used?.used)
        throw new ApiError(401, "invalid_code", "The code is wrong, used or expired.");
      const orders = await tx<{ order_id: string; pay_code: string }[]>`
        SELECT * FROM orders.recoverable_orders(${codeId})`;
      const response: RecoveryVerifyResponse = { orders: [] };
      for (const order of orders) {
        const token = newToken(TOKEN_PREFIX);
        await tx`SELECT orders.add_recovery_token(${codeId}, ${order.order_id}, ${token})`;
        response.orders.push({ orderCode: order.pay_code, token });
      }
      return response;
    });
    c.header("Cache-Control", "no-store");
    return c.json(body);
  });
