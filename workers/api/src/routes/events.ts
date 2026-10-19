// The event page's data for buyers (design 9.3, 10.1): an event on sale and its public
// ticket types, with the service charge per ticket and a coarse availability. The buyer
// actor sees only events on sale and their public types (Row Level Security), never data of
// other organizers. The answer is cached for a few seconds: the exact availability is
// decided only when holding.

import { type AvailabilityLevel, eventSlug, type PublicEvent } from "@passripple/contracts";
import { serviceCharge } from "@passripple/pricing";
import { Hono } from "hono";
import type { AppEnv } from "../app.ts";
import { feeSchedule } from "../config.ts";
import { BUYER_ACTOR } from "../db.ts";
import { ApiError } from "../errors.ts";
import { currentLegalVersions } from "../legal.ts";
import { isoRequired, param } from "../validation.ts";

interface EventRow {
  id: string;
  slug: string;
  name: string;
  venue_name: string;
  starts_at: Date;
  ends_at: Date;
  age_rating: "all" | "12plus" | "18plus";
}

interface TypeRow {
  id: string;
  name: string;
  zone: string | null;
  price_crc: number;
}

/** "few" when a tenth of the capacity or less is left. */
export function availabilityLevel(remaining: number, permitted: number): AvailabilityLevel {
  if (remaining <= 0) return "sold_out";
  return remaining * 10 <= permitted ? "few" : "available";
}

export const eventRoutes = new Hono<AppEnv>().get("/:slug", async (c) => {
  const slug = param(c.req.param("slug"), eventSlug);
  const schedule = feeSchedule(c.env);
  const body = await c.var.db.transaction(BUYER_ACTOR, async (tx): Promise<PublicEvent> => {
    const [event] = await tx<EventRow[]>`
      SELECT id, slug, name, venue_name, starts_at, ends_at, age_rating
        FROM events.events WHERE slug = ${slug} AND status = 'on_sale'`;
    if (!event) throw new ApiError(404, "not_found", "This event is not on sale.");
    const types = await tx<TypeRow[]>`
      SELECT id, name, zone, price_crc FROM catalog.ticket_types
       WHERE event_id = ${event.id} AND audience = 'public'
       ORDER BY price_crc, ref`;
    const [capacity] = await tx<{ remaining: number; permitted_capacity: number }[]>`
      SELECT * FROM inventory.availability(${event.id})`;
    const level = capacity
      ? availabilityLevel(capacity.remaining, capacity.permitted_capacity)
      : "sold_out";
    return {
      event: {
        id: event.id,
        slug: event.slug,
        name: event.name,
        venueName: event.venue_name,
        startsAt: isoRequired(event.starts_at),
        endsAt: isoRequired(event.ends_at),
        ageRating: event.age_rating,
      },
      ticketTypes: types.map((type) => {
        const charge = serviceCharge(type.price_crc, schedule);
        return {
          id: type.id,
          name: type.name,
          zone: type.zone,
          priceCrc: type.price_crc,
          serviceChargeCrc: charge.feeCrc + charge.feeTaxCrc,
          availability: level,
        };
      }),
      legal: await currentLegalVersions(tx),
    };
  });
  c.header("Cache-Control", "public, max-age=5");
  return c.json(body);
});
