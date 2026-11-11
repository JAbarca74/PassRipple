# @passripple/seo

**Kind:** module · **Level:** 4 (consumer)

## Responsibility

Pre-rendered public event pages, metadata, structured data and the sitemap.

## Owns

The `seo` database schema. No other module writes to it (rule R1).

- `seo.public_events(slug)`: published events (on sale, closed or cancelled) not over for more than 30 days, with locality, organizer and lowest public price. Readable by any actor: it holds only what the event page shows.
- `src/event-page.ts`: title and description templates (13.3), schema.org Event (13.4), the head tags and `sitemap.xml` (13.5), as pure functions. The site's Worker calls them (ADR 0040).

## Depends on

- `@passripple/contracts`
- `@passripple/events`
- `@passripple/catalog`
- `@passripple/identity`
- `@passripple/jurisdictions`

## Does not

Touch the checkout.

## Public API

Everything other packages may use is exported from `src/index.ts`. Deep imports are not allowed.
