// What search engines and link previews read from an event page (design 13.3 to 13.5, ADR
// 0040): the title and description templates, Open Graph tags, the schema.org Event data
// and the sitemap. Pure functions over the public listing: the site Worker injects their
// output into the page it serves, so WhatsApp, which never runs JavaScript, still sees them.

import type { SeoEvent } from "@passripple/contracts";

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
/** Costa Rica keeps UTC−6 all year. */
const COSTA_RICA_OFFSET_MS = -6 * 3600_000;

export interface SiteOrigins {
  /** The public site, where event pages live: https://passripple.com */
  readonly site: string;
  /** The app, where the "Comprar" button leads: https://app.passripple.com */
  readonly app: string;
}

function costaRica(instant: string): Date {
  return new Date(Date.parse(instant) + COSTA_RICA_OFFSET_MS);
}

/** "15 nov", in Costa Rica time. */
export function shortDate(instant: string): string {
  const local = costaRica(instant);
  return `${local.getUTCDate()} ${MONTHS[local.getUTCMonth()]}`;
}

/** "1:00 p. m.", in Costa Rica time. */
export function shortTime(instant: string): string {
  const local = costaRica(instant);
  const hours = local.getUTCHours();
  const minutes = String(local.getUTCMinutes()).padStart(2, "0");
  return `${hours % 12 === 0 ? 12 : hours % 12}:${minutes} ${hours < 12 ? "a. m." : "p. m."}`;
}

/** The instant as an ISO date-time with Costa Rica's offset: 2026-11-15T13:00:00-06:00. */
export function costaRicaIso(instant: string): string {
  return `${costaRica(instant).toISOString().slice(0, 19)}-06:00`;
}

function colones(amount: number): string {
  return `₡${String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
}

const AGE_TEXT: Record<SeoEvent["ageRating"], string> = {
  all: "Para todo público",
  "12plus": "Mayores de 12 años",
  "18plus": "Solo mayores de 18 años",
};

export function eventUrl(event: Pick<SeoEvent, "slug">, origins: SiteOrigins): string {
  return `${origins.site}/eventos/${event.slug}`;
}

/** "Motocross Pejibaye · 15 nov · Finca El Llano — Entradas" (13.3). */
export function eventTitle(event: SeoEvent): string {
  const suffix = event.status === "cancelled" ? "Cancelado" : "Entradas";
  return `${event.name} · ${shortDate(event.startsAt)} · ${event.venueName} — ${suffix}`;
}

/** Date, time, place, the lowest price and the age rating, in one sentence (13.3). */
export function eventDescription(event: SeoEvent): string {
  if (event.status === "cancelled") {
    return `${event.name} en ${event.venueName}, ${event.locality}, fue cancelado.`;
  }
  const when = `${shortDate(event.startsAt)}, ${shortTime(event.startsAt)}`;
  const price =
    event.status === "closed"
      ? "Venta cerrada."
      : event.fromPriceCrc === null
        ? "Entradas en PassRipple."
        : event.fromPriceCrc === 0
          ? "Entrada gratuita."
          : `Entradas desde ${colones(event.fromPriceCrc)}.`;
  return `${when} en ${event.venueName}, ${event.locality}. ${price} ${AGE_TEXT[event.ageRating]}.`;
}

/** schema.org Event for Google's event results (13.4). */
export function eventJsonLd(event: SeoEvent, origins: SiteOrigins, image: string): object {
  const url = eventUrl(event, origins);
  return {
    "@context": "https://schema.org",
    "@type": "Event",
    name: event.name,
    startDate: costaRicaIso(event.startsAt),
    endDate: costaRicaIso(event.endsAt),
    eventStatus:
      event.status === "cancelled"
        ? "https://schema.org/EventCancelled"
        : "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    location: {
      "@type": "Place",
      name: event.venueName,
      address: {
        "@type": "PostalAddress",
        addressLocality: event.locality,
        addressCountry: "CR",
      },
    },
    image: [image],
    description: eventDescription(event),
    organizer: { "@type": "Organization", name: event.organizerName },
    ...(event.fromPriceCrc !== null && {
      offers: {
        "@type": "Offer",
        price: String(event.fromPriceCrc),
        priceCurrency: "CRC",
        availability:
          event.status === "on_sale" ? "https://schema.org/InStock" : "https://schema.org/SoldOut",
        url,
      },
    }),
  };
}

const HTML_ENTITIES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Escapes text for HTML content and attributes in a single pass, so nothing is escaped twice. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => HTML_ENTITIES[char] ?? char);
}

/**
 * The tags for the page's <head>: description, canonical link, Open Graph and Twitter
 * cards, and the JSON-LD, escaped so no event text can close the script element.
 */
export function eventHeadTags(event: SeoEvent, origins: SiteOrigins, image: string): string {
  const title = escapeHtml(eventTitle(event));
  const description = escapeHtml(eventDescription(event));
  const url = escapeHtml(eventUrl(event, origins));
  const jsonLd = JSON.stringify(eventJsonLd(event, origins, image)).replace(/</g, "\\u003c");
  return [
    `<meta name="description" content="${description}">`,
    `<link rel="canonical" href="${url}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="PassRipple">`,
    `<meta property="og:locale" content="es_CR">`,
    `<meta property="og:title" content="${title}">`,
    `<meta property="og:description" content="${description}">`,
    `<meta property="og:url" content="${url}">`,
    `<meta property="og:image" content="${escapeHtml(image)}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<script type="application/ld+json">${jsonLd}</script>`,
  ].join("\n");
}

/**
 * sitemap.xml (13.5): the fixed pages and every listed event that is not cancelled, with the
 * publication date as lastmod.
 */
export function sitemapXml(
  events: readonly SeoEvent[],
  origins: SiteOrigins,
  fixedPaths: readonly string[],
): string {
  const urls = [
    ...fixedPaths.map((path) => `  <url><loc>${escapeHtml(origins.site + path)}</loc></url>`),
    ...events
      .filter((event) => event.status !== "cancelled")
      .map(
        (event) =>
          `  <url><loc>${escapeHtml(eventUrl(event, origins))}</loc><lastmod>${event.publishedAt.slice(0, 10)}</lastmod></url>`,
      ),
  ];
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    "</urlset>",
    "",
  ].join("\n");
}
