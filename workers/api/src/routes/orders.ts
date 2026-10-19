// The buyer's checkout (design 10.1 to 10.3, ADR 0033), without an account. Placing an
// order holds the tickets (I2), freezes the price and service charge (I5), gives the order
// a unique amount when it can (ADR 0031) and records the acceptance of the documents shown
// next to the pay button (14.3). The access token goes back once and travels after that as
// a bearer token, never in a URL.

import {
  createOrderRequest,
  IDEMPOTENCY_HEADER,
  idempotencyKey,
  ORDER_TOKEN_PREFIX,
  type OrderState,
  type OrderStatus,
  type PlacedOrder,
} from "@passripple/contracts";
import { feeRule, serviceCharge } from "@passripple/pricing";
import { Hono } from "hono";
import type { AppEnv } from "../app.ts";
import { bearer } from "../auth.ts";
import { feeSchedule, maxAmountOffset, sinpeNumber } from "../config.ts";
import { BUYER_ACTOR } from "../db.ts";
import { required } from "../env.ts";
import { ApiError } from "../errors.ts";
import { currentLegalVersions } from "../legal.ts";
import { newPayCodes, orderToken } from "../secrets.ts";
import { iso, isoRequired, jsonBody, param } from "../validation.ts";

/** Holds last 30 minutes, to give time to pay and for the bank's notice (10.2). */
const HOLD_MINUTES = 30;
/** Payment code candidates per order; the database takes the first one free. */
const PAY_CODE_CANDIDATES = 4;

interface PlacedRow {
  order_id: string;
  status?: OrderStatus;
  pay_code: string;
  amount_crc: number;
  amount_unique: boolean;
  expires_at: Date;
}

interface TokenRow {
  id: string;
  status: OrderStatus;
  amount_crc: number;
  pay_code: string;
  expires_at: Date;
  paid_at: Date | null;
}

export const orderRoutes = new Hono<AppEnv>()
  .post("/", async (c) => {
    const key = param(c.req.header(IDEMPOTENCY_HEADER), idempotencyKey);
    const input = await jsonBody(c, createOrderRequest);
    const token = await orderToken(required(c.env, "SIGN_IN_PEPPER"), key);
    const schedule = feeSchedule(c.env);
    const sinpe = sinpeNumber(c.env);
    const maxOffset = maxAmountOffset(c.env);

    const { row, created } = await c.var.db.transaction(BUYER_ACTOR, async (tx) => {
      // A retry of a checkout that already went through: the same order, the same token.
      const [existing] = await tx<PlacedRow[]>`SELECT * FROM orders.order_by_idem_key(${key})`;
      if (existing) return { row: existing, created: false };

      const legal = await currentLegalVersions(tx);
      if (
        legal.termsVersion !== input.termsVersion ||
        legal.privacyVersion !== input.privacyVersion
      ) {
        throw new ApiError(409, "terms_changed", "The terms changed. Review them and try again.");
      }

      const [type] = await tx<{ price_crc: number }[]>`
        SELECT price_crc FROM catalog.ticket_types
         WHERE id = ${input.ticketTypeId} AND event_id = ${input.eventId} AND audience = 'public'`;
      if (!type) throw new ApiError(404, "not_found", "This ticket type is not on sale.");

      const [hold] = await tx<{ id: string | null }[]>`
        SELECT inventory.hold(${input.eventId}, ${input.ticketTypeId}, ${input.quantity},
                              make_interval(mins => ${HOLD_MINUTES})) AS id`;
      if (!hold?.id) throw new ApiError(409, "sold_out", "There are not enough tickets left.");

      const charge = serviceCharge(type.price_crc, schedule);
      const email = "email" in input.contact ? input.contact.email : null;
      const phone = "phone" in input.contact ? input.contact.phone : null;
      // Payment codes are Crockford Base32 letters and digits: the literal needs no quoting.
      const codes = `{${newPayCodes(PAY_CODE_CANDIDATES).join(",")}}`;
      const [placed] = await tx<PlacedRow[]>`
        SELECT * FROM orders.place(${hold.id}, ${key}, ${email}, ${phone}, ${token},
                                   ${codes}::text[], ${charge.feeCrc}, ${charge.feeTaxCrc},
                                   ${feeRule(schedule)}, ${maxOffset})`;
      if (!placed) throw new Error("orders.place returned no order");

      // The buyer accepted the documents shown next to the pay button, and chose whether to
      // receive commercial messages. The subject is the order, never contact data (14.4).
      await tx`SELECT privacy.record_consent(${placed.order_id}, 'terms', true, ${legal.termsVersion}, 'checkout')`;
      await tx`SELECT privacy.record_consent(${placed.order_id}, 'privacy', true, ${legal.privacyVersion}, 'checkout')`;
      await tx`SELECT privacy.record_consent(${placed.order_id}, 'marketing', ${input.marketing}, ${legal.privacyVersion}, 'checkout')`;
      return { row: { ...placed, status: "pending" as const }, created: true };
    });

    const body: PlacedOrder = {
      token,
      orderCode: row.pay_code,
      status: row.status ?? "pending",
      amountCrc: row.amount_crc,
      amountUnique: row.amount_unique,
      sinpeNumber: sinpe,
      expiresAt: isoRequired(row.expires_at),
    };
    c.header("Cache-Control", "no-store");
    return c.json(body, created ? 201 : 200);
  })

  // The payment screen polls this until the order is paid or expires.
  .get("/current", async (c) => {
    const token = bearer(c, ORDER_TOKEN_PREFIX);
    const row = await c.var.db.transaction(BUYER_ACTOR, async (tx) => {
      const [found] = await tx<TokenRow[]>`SELECT * FROM orders.order_for_token(${token})`;
      return found;
    });
    if (!row) throw new ApiError(401, "unauthorized", "This order link is not valid.");
    const body: OrderState = {
      orderCode: row.pay_code,
      status: row.status,
      amountCrc: row.amount_crc,
      expiresAt: isoRequired(row.expires_at),
      paidAt: iso(row.paid_at),
    };
    c.header("Cache-Control", "no-store");
    return c.json(body);
  });
