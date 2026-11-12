import type { SeoEvent } from "@passripple/contracts";
import { describe, expect, test } from "vitest";
import {
  costaRicaIso,
  escapeHtml,
  eventDescription,
  eventHeadTags,
  eventJsonLd,
  eventTitle,
  shortDate,
  shortTime,
  sitemapXml,
} from "./event-page.ts";

const origins = { site: "https://passripple.com", app: "https://app.passripple.com" };
const image = "https://passripple.com/og/default.png";

const event: SeoEvent = {
  slug: "motocross-pejibaye",
  name: "Motocross Pejibaye",
  venueName: "Finca El Llano",
  locality: "Pérez Zeledón",
  organizerName: "Asociación Deportiva",
  // 13:00 in Costa Rica.
  startsAt: "2026-11-15T19:00:00.000Z",
  endsAt: "2026-11-16T01:00:00.000Z",
  status: "on_sale",
  ageRating: "all",
  fromPriceCrc: 5000,
  publishedAt: "2026-11-01T15:00:00.000Z",
};

describe("dates in Costa Rica time", () => {
  test("short date, 12-hour time and ISO with the offset", () => {
    expect(shortDate(event.startsAt)).toBe("15 nov");
    expect(shortTime(event.startsAt)).toBe("1:00 p. m.");
    expect(shortTime("2026-11-15T06:05:00.000Z")).toBe("12:05 a. m.");
    expect(shortTime("2026-11-15T15:30:00.000Z")).toBe("9:30 a. m.");
    expect(shortTime("2026-11-15T18:00:00.000Z")).toBe("12:00 p. m.");
    expect(costaRicaIso(event.startsAt)).toBe("2026-11-15T13:00:00-06:00");
  });

  test("an evening event in UTC's next day keeps its local date", () => {
    expect(shortDate("2026-11-16T03:00:00.000Z")).toBe("15 nov");
  });
});

describe("title and description (13.3)", () => {
  test("an event on sale", () => {
    expect(eventTitle(event)).toBe("Motocross Pejibaye · 15 nov · Finca El Llano — Entradas");
    expect(eventDescription(event)).toBe(
      "15 nov, 1:00 p. m. en Finca El Llano, Pérez Zeledón. Entradas desde ₡5.000. Para todo público.",
    );
  });

  test("free, without public types, closed, adults only and cancelled", () => {
    expect(eventDescription({ ...event, fromPriceCrc: 0 })).toContain("Entrada gratuita.");
    expect(eventDescription({ ...event, fromPriceCrc: null })).toContain("Entradas en PassRipple.");
    expect(eventDescription({ ...event, status: "closed" })).toContain("Venta cerrada.");
    expect(eventDescription({ ...event, ageRating: "18plus" })).toContain("Solo mayores de 18");
    expect(eventDescription({ ...event, ageRating: "12plus" })).toContain("Mayores de 12");
    const cancelled = { ...event, status: "cancelled" as const };
    expect(eventTitle(cancelled)).toMatch(/— Cancelado$/);
    expect(eventDescription(cancelled)).toBe(
      "Motocross Pejibaye en Finca El Llano, Pérez Zeledón, fue cancelado.",
    );
  });
});

describe("structured data (13.4)", () => {
  test("an Event with place, organizer and offer", () => {
    expect(eventJsonLd(event, origins, image)).toMatchObject({
      "@type": "Event",
      startDate: "2026-11-15T13:00:00-06:00",
      eventStatus: "https://schema.org/EventScheduled",
      location: { name: "Finca El Llano", address: { addressLocality: "Pérez Zeledón" } },
      organizer: { name: "Asociación Deportiva" },
      offers: {
        price: "5000",
        priceCurrency: "CRC",
        availability: "https://schema.org/InStock",
        url: "https://passripple.com/eventos/motocross-pejibaye",
      },
    });
  });

  test("cancelled or closed events, and events without a price", () => {
    expect(eventJsonLd({ ...event, status: "cancelled" }, origins, image)).toMatchObject({
      eventStatus: "https://schema.org/EventCancelled",
    });
    expect(eventJsonLd({ ...event, status: "closed" }, origins, image)).toMatchObject({
      offers: { availability: "https://schema.org/SoldOut" },
    });
    expect(eventJsonLd({ ...event, fromPriceCrc: null }, origins, image)).not.toHaveProperty(
      "offers",
    );
  });
});

describe("head tags", () => {
  test("escapes event text and cannot close the JSON-LD script", () => {
    const hostile = { ...event, name: `Fiesta "VIP" </script><script>alert(1)</script>` };
    const tags = eventHeadTags(hostile, origins, image);
    expect(tags).toContain(
      '<meta property="og:title" content="Fiesta &quot;VIP&quot; &lt;/script&gt;',
    );
    expect(tags).not.toContain("</script><script>");
    expect(tags.match(/<\/script>/g)).toHaveLength(1);
    expect(tags).toContain(
      '<link rel="canonical" href="https://passripple.com/eventos/motocross-pejibaye">',
    );
  });

  test("escapeHtml", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;",
    );
  });
});

describe("sitemap (13.5)", () => {
  test("fixed pages and events, leaving cancelled ones out", () => {
    const xml = sitemapXml([event, { ...event, slug: "cancelado", status: "cancelled" }], origins, [
      "/",
      "/privacidad",
    ]);
    expect(xml).toContain("<loc>https://passripple.com/</loc>");
    expect(xml).toContain("<loc>https://passripple.com/privacidad</loc>");
    expect(xml).toContain(
      "<loc>https://passripple.com/eventos/motocross-pejibaye</loc><lastmod>2026-11-01</lastmod>",
    );
    expect(xml).not.toContain("cancelado");
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
  });
});
