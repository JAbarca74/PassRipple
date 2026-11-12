import type { SeoEvent } from "@passripple/contracts";
import { describe, expect, test } from "vitest";
import { EVENT_DATA_ID, embeddedEvent, eventFromListing } from "./event-data.ts";

const listing: SeoEvent = {
  slug: "motocross-pz",
  name: "Motocross",
  venueName: "Finca El Llano",
  locality: "Pérez Zeledón",
  organizerName: "Asociación",
  startsAt: "2026-11-15T19:00:00.000Z",
  endsAt: "2026-11-16T01:00:00.000Z",
  status: "closed",
  ageRating: "18plus",
  fromPriceCrc: 5000,
  publishedAt: "2026-11-01T15:00:00.000Z",
};

const doc = (text: string | null) => ({
  getElementById: (id: string) =>
    id === EVENT_DATA_ID && text !== null ? ({ textContent: text } as HTMLElement) : null,
});

describe("embedded event data", () => {
  test("maps the listing to the page's event", () => {
    expect(eventFromListing(listing)).toEqual({
      slug: "motocross-pz",
      name: "Motocross",
      startsAt: new Date("2026-11-15T19:00:00.000Z"),
      venue: "Finca El Llano",
      canton: "Pérez Zeledón",
      organizer: { name: "Asociación", verified: true },
      adultsOnly: true,
      status: "closed",
      fromPrice: 5000,
      ticketTypes: [],
    });
    expect(eventFromListing({ ...listing, status: "on_sale", ageRating: "all" })).toMatchObject({
      status: "on-sale",
      adultsOnly: false,
    });
  });

  test("reads it from the page, and ignores a missing or broken one", () => {
    expect(embeddedEvent(doc(JSON.stringify(listing)))?.slug).toBe("motocross-pz");
    expect(embeddedEvent(doc(null))).toBeUndefined();
    expect(embeddedEvent(doc("{not json"))).toBeUndefined();
  });
});
