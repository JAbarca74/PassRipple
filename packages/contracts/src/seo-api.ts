// The public listing of events for search engines and link previews (design 13.2 to 13.5,
// ADR 0040): what an event page's title, description, Open Graph tags, structured data and
// the sitemap need. Everything here is already public on the event page.

import { z } from "zod";
import { AGE_RATINGS, eventSlug } from "./checkout-api.ts";

const isoTime = z.iso.datetime({ offset: true });

export const PUBLIC_EVENT_STATUSES = ["on_sale", "closed", "cancelled"] as const;
export type PublicEventStatus = (typeof PUBLIC_EVENT_STATUSES)[number];

export const seoEvent = z.object({
  slug: eventSlug,
  name: z.string(),
  venueName: z.string(),
  /** The canton, for the address in structured data. */
  locality: z.string(),
  organizerName: z.string(),
  startsAt: isoTime,
  endsAt: isoTime,
  status: z.enum(PUBLIC_EVENT_STATUSES),
  ageRating: z.enum(AGE_RATINGS),
  /** The lowest public price; null when the event sells no public ticket type. */
  fromPriceCrc: z.int().nonnegative().nullable(),
  publishedAt: isoTime,
});
export type SeoEvent = z.infer<typeof seoEvent>;

/** GET /v1/events (optionally ?slug=): published events not over for more than 30 days. */
export const seoEventsResponse = z.object({ events: z.array(seoEvent) });
export type SeoEventsResponse = z.infer<typeof seoEventsResponse>;
