// The buyer's wallet (design 6.2, 6.6, ADR 0030, 0032, 0035). The order's token is checked
// and the order's tickets read in one statement (orders.wallet_tickets), so a token never
// reaches another order. Binding ties every unbound ticket of the order to the device's key;
// a ticket bound to another device is rebound only with a recovery token. Certificates are
// signed on every read with the server key from the Worker's secrets.

import {
  BUYER_EXPORT_FORMAT,
  type BuyerExport,
  bindRequest,
  decodeBase64url,
  encodeBase64url,
  encodeCertificate,
  HELD_TOKEN_PREFIX,
  type OrderStatus,
  type RecoveryVerifyResponse,
  recoveryRequest,
  recoveryVerifyRequest,
  ORDER_TOKEN_PREFIX as TOKEN_PREFIX,
  type WalletPreferences,
  type WalletTicket,
  type WalletView,
  walletPreferencesRequest,
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
import { currentLegalVersions } from "../legal.ts";
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

export interface TicketRow {
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

/** Which of these tickets were ever transferred (6.6): they belong to their receivers. */
export async function transferredIds(tx: Tx, rows: readonly TicketRow[]): Promise<Set<string>> {
  if (rows.length === 0) return new Set();
  const ids = `{${rows.map((row) => row.ticket_id).join(",")}}`;
  const found = await tx<{ id: string }[]>`
    SELECT id FROM ticketing.transferred_tickets(${ids}::uuid[]) AS id`;
  return new Set(found.map((row) => row.id));
}

export function sameKey(a: Uint8Array | null, b: Uint8Array): boolean {
  if (a === null || a.length !== b.length) return false;
  return a.every((byte, index) => byte === b[index]);
}

export async function ticketView(
  row: TicketRow,
  signer: ServerSigner | null,
  transferred = false,
): Promise<WalletTicket> {
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
    transferred,
  };
}

async function view(
  c: Context<AppEnv>,
  access: AccessRow,
  rows: TicketRow[],
  transferred: Set<string>,
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
    tickets: await Promise.all(
      rows.map((row) => ticketView(row, signer, transferred.has(row.ticket_id))),
    ),
    boundElsewhere,
  };
}

export const walletRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const token = bearer(c, TOKEN_PREFIX);
    const { access, rows, transferred } = await c.var.db.transaction(SYSTEM_ACTOR, async (tx) => {
      const access = await walletAccess(tx, token);
      const rows = await walletTickets(tx, token);
      return { access, rows, transferred: await transferredIds(tx, rows) };
    });
    c.header("Cache-Control", "no-store");
    return c.json(await view(c, access, rows, transferred, 0));
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
      const before = await walletTickets(tx, token);
      // A ticket the buyer gave away belongs to its receiver: recovery does not reach it.
      const given = await transferredIds(tx, before);
      for (const row of before) {
        if (row.status === "issued") {
          await tx`SELECT ticketing.bind(${row.ticket_id}, ${key}, 'bind')`;
        } else if (row.status === "bound" && !sameKey(row.holder_pubkey, key)) {
          if (access.can_rebind && !given.has(row.ticket_id)) {
            await tx`SELECT ticketing.bind(${row.ticket_id}, ${key}, 'recovery')`;
            rebound = true;
          } else {
            boundElsewhere++;
          }
        }
      }
      // A recovery token rebinds once: a second device with the same token cannot.
      if (rebound) await tx`SELECT orders.consume_rebind(${token})`;
      const rows = await walletTickets(tx, token);
      return { access, rows, given, boundElsewhere };
    });
    c.header("Cache-Control", "no-store");
    return c.json(await view(c, result.access, result.rows, result.given, result.boundElsewhere));
  })

  // The news choice (14.4): read it, or record a new one on every order of the same
  // contact, against the privacy policy in force.
  .get("/preferences", async (c) => {
    const token = bearer(c, TOKEN_PREFIX);
    const body = await c.var.db.transaction(SYSTEM_ACTOR, async (tx) => {
      await walletAccess(tx, token);
      return { marketing: await marketingOf(tx, token) };
    });
    c.header("Cache-Control", "no-store");
    return c.json(body satisfies WalletPreferences);
  })

  .post("/preferences", async (c) => {
    const token = bearer(c, TOKEN_PREFIX);
    const { marketing } = await jsonBody(c, walletPreferencesRequest);
    const body = await c.var.db.transaction(SYSTEM_ACTOR, async (tx) => {
      await walletAccess(tx, token);
      const { privacyVersion } = await currentLegalVersions(tx);
      const orders = await tx<{ order_id: string }[]>`
        SELECT order_id FROM orders.contact_orders(${token})`;
      for (const { order_id } of orders) {
        await tx`SELECT privacy.record_consent(${order_id}, 'marketing', ${marketing}, ${privacyVersion}, 'wallet')`;
      }
      return { marketing: await marketingOf(tx, token) };
    });
    c.header("Cache-Control", "no-store");
    return c.json(body satisfies WalletPreferences);
  })

  // Recovery on a new device (6.6, ADR 0036): a code to the order's email.
  .post("/recovery", async (c) => {
    const { contact } = await jsonBody(c, recoveryRequest);
    await sendContactCode(c, emailOf(contact), "recovery");
    return c.json({ expiresInSeconds: CONTACT_CODE_TTL_SECONDS }, 202);
  })

  // The code matched: one new token per paid order of that email, and one per ticket
  // received with it and still held. Each may rebind its tickets to this device once,
  // within an hour, through POST /wallet/bind or POST /transfers/held/bind.
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
      const response: RecoveryVerifyResponse = { orders: [], held: [] };
      for (const order of orders) {
        const token = newToken(TOKEN_PREFIX);
        await tx`SELECT orders.add_recovery_token(${codeId}, ${order.order_id}, ${token})`;
        response.orders.push({ orderCode: order.pay_code, token });
      }
      const held = await tx<{ transfer_id: string; event_name: string }[]>`
        SELECT * FROM orders.recoverable_held(${codeId})`;
      for (const claim of held) {
        const token = newToken(HELD_TOKEN_PREFIX);
        await tx`SELECT ticketing.recover_held(${claim.transfer_id}, ${token})`;
        response.held.push({ eventName: claim.event_name, token });
      }
      return response;
    });
    c.header("Cache-Control", "no-store");
    return c.json(body);
  })

  // Right of access (14.7): a code to the email, then everything kept about it.
  .post("/export", async (c) => {
    const { contact } = await jsonBody(c, recoveryRequest);
    await sendContactCode(c, emailOf(contact), "export");
    return c.json({ expiresInSeconds: CONTACT_CODE_TTL_SECONDS }, 202);
  })

  .post("/export/verify", async (c) => {
    const { contact, code } = await jsonBody(c, recoveryVerifyRequest);
    const email = emailOf(contact);
    const codeId = await checkContactCode(c, email, "export", code);
    const document = await c.var.db.transaction(SYSTEM_ACTOR, async (tx) => {
      const [used] = await tx<
        { used: boolean }[]
      >`SELECT orders.use_contact_code(${codeId}) AS used`;
      if (!used?.used)
        throw new ApiError(401, "invalid_code", "The code is wrong, used or expired.");
      const [row] = await tx<{ document: RawExport }[]>`
        SELECT orders.buyer_export(${codeId}) AS document`;
      if (!row) throw new Error("orders.buyer_export returned nothing");
      const [received] = await tx<{ received: BuyerExport["received"] }[]>`
        SELECT orders.received_export(${codeId}) AS received`;
      return { ...row.document, received: received?.received ?? [] };
    });
    const body: BuyerExport = {
      format: BUYER_EXPORT_FORMAT,
      generatedAt: new Date().toISOString(),
      ...isoTimes(document),
      orders: isoTimes(document.orders).map((order) => ({
        ...order,
        tickets: order.tickets.map((ticket) => ({
          ...ticket,
          humanCode: ticket.humanCode === null ? null : formatHumanCode(ticket.humanCode),
        })),
      })),
    };
    c.header("Cache-Control", "no-store");
    return c.json(body);
  });

async function marketingOf(tx: Tx, token: string): Promise<boolean | null> {
  const [row] = await tx<{ granted: boolean | null }[]>`
    SELECT orders.marketing_preference(${token}) AS granted`;
  return row?.granted ?? null;
}

/** The document as orders.buyer_export builds it: Postgres times, raw ticket codes. */
type RawExport = Omit<BuyerExport, "format" | "generatedAt">;

/** Rewrites every `…At` string of a JSON value as an ISO 8601 time in UTC. */
function isoTimes<T>(value: T): T {
  if (Array.isArray(value)) return value.map(isoTimes) as T;
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      key.endsWith("At") && typeof item === "string"
        ? new Date(item).toISOString()
        : isoTimes(item),
    ]),
  ) as T;
}
