// Free transfers through a private link (design 6.6). The holder's phone offers one ticket
// with a signature from the key the ticket is bound to, so a forwarded order link is not
// enough to give tickets away. The link carries the offer's secret; whoever claims it binds
// the ticket to their own device and gets a token that reaches that ticket only.

import {
  type ClaimResponse,
  claimRequest,
  decodeBase64url,
  encodeBase64url,
  HELD_TOKEN_PREFIX,
  type HeldView,
  heldBindRequest,
  OFFER_TOKEN_PREFIX,
  ORDER_TOKEN_PREFIX,
  offerRequest,
  type TransferOffered,
  type TransferPreview,
  type TransferProof,
  transferProof,
} from "@passripple/contracts";
import { isAcceptableHolderKey, verifyTransferProof } from "@passripple/crypto";
import { type Context, Hono } from "hono";
import type { AppEnv } from "../app.ts";
import { SYSTEM_ACTOR, type Tx } from "../db.ts";
import { ApiError } from "../errors.ts";
import { newToken } from "../secrets.ts";
import { serverKeys, serverSigner } from "../server-keys.ts";
import { isoRequired, jsonBody } from "../validation.ts";
import { namedInfo, type TicketRow, ticketView, transferredIds } from "./wallet.ts";

/** How long a transfer link stays open, unless the event starts first. */
const OFFER_TTL_HOURS = 48;

const UNAUTHORIZED = () => new ApiError(401, "unauthorized", "This link is not valid.");

/** The bearer token of a buyer's order or of a receiver, whichever the request carries. */
export function holderToken(c: Context<AppEnv>): string {
  const match = /^Bearer (\S+)$/.exec(c.req.header("authorization") ?? "");
  const token = match?.[1];
  if (
    !token ||
    token.length > 128 ||
    !(token.startsWith(ORDER_TOKEN_PREFIX) || token.startsWith(HELD_TOKEN_PREFIX))
  ) {
    throw UNAUTHORIZED();
  }
  return token;
}

/** The tickets a token reaches: an order's, or a receiver's one ticket. */
function reachableTickets(tx: Tx, token: string): Promise<TicketRow[]> {
  return token.startsWith(HELD_TOKEN_PREFIX)
    ? tx<TicketRow[]>`SELECT * FROM ticketing.held_ticket(${token})`
    : tx<TicketRow[]>`SELECT * FROM orders.wallet_tickets(${token})`;
}

function key(text: string): Uint8Array {
  const bytes = decodeBase64url(text);
  if (bytes === null || bytes.length !== 32 || !isAcceptableHolderKey(bytes)) {
    throw new ApiError(400, "invalid_key", "This device key cannot hold tickets.");
  }
  return bytes;
}

/**
 * Checks the holder's signature and that the token reaches the ticket, and returns the
 * ticket's row and the signing key. The database checks again that the key holds it. The
 * proof is the request's body unless the caller already read it.
 */
export async function provenHolder(
  c: Context<AppEnv>,
  tx: Tx,
  given?: TransferProof,
): Promise<{ row: TicketRow; publicKey: Uint8Array }> {
  const token = holderToken(c);
  const proof = given ?? (await jsonBody(c, transferProof));
  const publicKey = key(proof.publicKey);
  const signature = decodeBase64url(proof.signature);
  const row = (await reachableTickets(tx, token)).find((t) => t.ticket_id === proof.ticketId);
  if (!row) throw UNAUTHORIZED();
  if (
    signature === null ||
    !verifyTransferProof(
      { ticketId: row.ticket_id, keyVersion: row.key_version, issuedAt: proof.issuedAt },
      signature,
      publicKey,
      Math.floor(Date.now() / 1000),
    )
  ) {
    throw new ApiError(403, "not_holder", "Only the phone holding this ticket can transfer it.");
  }
  return { row, publicKey };
}

export const transferRoutes = new Hono<AppEnv>()
  // Offers one ticket. A new offer replaces the ticket's open one.
  .post("/", async (c) => {
    const offerToken = newToken(OFFER_TOKEN_PREFIX);
    const expiresAt = await c.var.db.transaction(SYSTEM_ACTOR, async (tx) => {
      const { row, publicKey } = await provenHolder(c, tx);
      const [offered] = await tx<{ expires_at: Date }[]>`
        SELECT ticketing.offer_transfer(${row.ticket_id}, ${publicKey}, ${offerToken},
                                        make_interval(hours => ${OFFER_TTL_HOURS})) AS expires_at`;
      if (!offered) throw new Error("ticketing.offer_transfer returned nothing");
      return offered.expires_at;
    });
    const body: TransferOffered = { offerToken, expiresAt: isoRequired(expiresAt) };
    c.header("Cache-Control", "no-store");
    return c.json(body, 201);
  })

  // Withdraws the ticket's open offer.
  .post("/cancel", async (c) => {
    await c.var.db.transaction(SYSTEM_ACTOR, async (tx) => {
      const { row, publicKey } = await provenHolder(c, tx);
      await tx`SELECT ticketing.cancel_transfer(${row.ticket_id}, ${publicKey})`;
    });
    return c.body(null, 204);
  })

  // What the receiver sees before accepting.
  .post("/preview", async (c) => {
    const { offerToken } = await jsonBody(c, offerRequest);
    const [found] = await c.var.db.transaction(
      SYSTEM_ACTOR,
      (tx) =>
        tx<
          {
            event_name: string;
            venue_name: string;
            starts_at: Date;
            type_name: string;
            expires_at: Date;
            state: TransferPreview["state"];
          }[]
        >`SELECT * FROM ticketing.transfer_offer(${offerToken})`,
    );
    if (!found) throw new ApiError(404, "not_found", "This transfer link does not exist.");
    const body: TransferPreview = {
      eventName: found.event_name,
      venueName: found.venue_name,
      startsAt: isoRequired(found.starts_at),
      typeName: found.type_name,
      expiresAt: isoRequired(found.expires_at),
      state: found.state,
    };
    c.header("Cache-Control", "no-store");
    return c.json(body);
  })

  // Binds the ticket to the receiver's device and gives them their token.
  .post("/claim", async (c) => {
    const { offerToken, publicKey, email } = await jsonBody(c, claimRequest);
    const holderKey = key(publicKey);
    const token = newToken(HELD_TOKEN_PREFIX);
    await c.var.db.transaction(SYSTEM_ACTOR, async (tx) => {
      await tx`SELECT ticketing.claim_transfer(${offerToken}, ${holderKey}, ${token},
                                               ${email ?? null})`;
    });
    const body: ClaimResponse = { token };
    c.header("Cache-Control", "no-store");
    return c.json(body, 201);
  })

  // The receiver's wallet: their one ticket, with a fresh certificate while they hold it.
  .get("/held", async (c) => heldView(c, receiverToken(c)))

  // After recovery by email: moves the receiver's ticket to this device, once.
  .post("/held/bind", async (c) => {
    const token = receiverToken(c);
    const { publicKey } = await jsonBody(c, heldBindRequest);
    const holderKey = key(publicKey);
    await c.var.db.transaction(SYSTEM_ACTOR, async (tx) => {
      await tx`SELECT ticketing.rebind_held(${token}, ${holderKey})`;
    });
    return heldView(c, token);
  });

function receiverToken(c: Context<AppEnv>): string {
  const token = holderToken(c);
  if (!token.startsWith(HELD_TOKEN_PREFIX)) throw UNAUTHORIZED();
  return token;
}

async function heldView(c: Context<AppEnv>, token: string): Promise<Response> {
  const { row, transferred, named } = await c.var.db.transaction(SYSTEM_ACTOR, async (tx) => {
    const [row] = await reachableTickets(tx, token);
    if (!row) throw UNAUTHORIZED();
    return {
      row,
      transferred: await transferredIds(tx, [row]),
      named: await namedInfo(tx, [row]),
    };
  });
  const signer = row.status === "bound" ? await serverSigner(c.env) : null;
  const body: HeldView = {
    event: {
      id: row.event_id,
      name: row.event_name,
      venueName: row.venue_name,
      startsAt: isoRequired(row.starts_at),
    },
    serverKeys: serverKeys(c.env).map((k) => ({
      id: k.id,
      publicKey: encodeBase64url(k.publicKey),
    })),
    ticket: await ticketView(row, signer, transferred.has(row.ticket_id), named.get(row.ticket_id)),
  };
  c.header("Cache-Control", "no-store");
  return c.json(body);
}
