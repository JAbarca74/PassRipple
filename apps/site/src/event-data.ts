// A real event page gets its data from the page itself: the site's Worker embeds the event's
// public listing as JSON (never executed) when it serves /eventos/<slug> (ADR 0040), so the
// page needs no API call and no cross-origin access.

import type { SeoEvent } from "@passripple/contracts";
import type { EventStatus, PublicEvent } from "./data.ts";

export const EVENT_DATA_ID = "event-data";

const STATUSES: Record<SeoEvent["status"], EventStatus> = {
  on_sale: "on-sale",
  closed: "closed",
  cancelled: "cancelled",
};

/** The page's shape for an event from the public listing. */
export function eventFromListing(listing: SeoEvent): PublicEvent {
  return {
    slug: listing.slug,
    name: listing.name,
    startsAt: new Date(listing.startsAt),
    venue: listing.venueName,
    canton: listing.locality,
    organizer: { name: listing.organizerName, verified: true },
    adultsOnly: listing.ageRating === "18plus",
    status: STATUSES[listing.status],
    fromPrice: listing.fromPriceCrc,
    ticketTypes: [],
  };
}

/** The event the Worker embedded in this page, if any. */
export function embeddedEvent(doc: Pick<Document, "getElementById">): PublicEvent | undefined {
  const text = doc.getElementById(EVENT_DATA_ID)?.textContent;
  if (!text) return undefined;
  try {
    return eventFromListing(JSON.parse(text) as SeoEvent);
  } catch {
    return undefined;
  }
}
