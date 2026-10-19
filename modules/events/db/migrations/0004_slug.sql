-- The event's address in links (design 10.1, 13.2): app.<domain>/comprar?evento=<slug>.
-- Lowercase words of letters and digits joined by hyphens, unique across the platform. It is
-- optional until the organizer publishes the event's page.

ALTER TABLE events.events
  ADD COLUMN slug text UNIQUE
    CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) BETWEEN 3 AND 80);

GRANT INSERT (slug), UPDATE (slug) ON events.events TO passripple_api;
