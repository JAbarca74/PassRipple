-- The public face of events for search engines and link previews (design 13.2 to 13.5,
-- ADR 0040): every published event that has not been over for more than 30 days, with what
-- an event page's title, description and structured data need. Everything here is already
-- public on the event page, so any actor may read it, the anonymous buyer included.
--
-- status: on_sale, closed (sales ended) or cancelled. Drafts and events awaiting
-- authorization never appear. from_price_crc is the lowest public price, NULL when the
-- event has no public ticket type.

CREATE FUNCTION seo.public_events(p_slug text DEFAULT NULL)
RETURNS TABLE (
  slug           text,
  name           text,
  venue_name     text,
  locality       text,
  organizer_name text,
  starts_at      timestamptz,
  ends_at        timestamptz,
  status         text,
  age_rating     text,
  from_price_crc integer,
  published_at   timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT e.slug,
         e.name,
         e.venue_name,
         j.name,
         o.name,
         e.starts_at,
         e.ends_at,
         e.status,
         e.age_rating,
         (SELECT min(t.price_crc)::integer
            FROM catalog.ticket_types t
           WHERE t.event_id = e.id AND t.audience = 'public'),
         e.published_at
    FROM events.events e
    JOIN identity.organizations o ON o.id = e.org_id
    JOIN jurisdictions.jurisdictions j ON j.canton_code = e.canton_code
   WHERE e.slug IS NOT NULL
     AND e.published_at IS NOT NULL
     AND e.status IN ('on_sale', 'closed', 'cancelled')
     AND e.ends_at > now() - interval '30 days'
     AND (p_slug IS NULL OR e.slug = p_slug)
   ORDER BY e.starts_at, e.slug
$$;

REVOKE ALL ON FUNCTION seo.public_events(text) FROM PUBLIC;
GRANT USAGE ON SCHEMA seo TO passripple_api;
GRANT EXECUTE ON FUNCTION seo.public_events(text) TO passripple_api;
