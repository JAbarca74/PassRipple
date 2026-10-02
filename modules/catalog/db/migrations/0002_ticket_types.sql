-- Ticket types, prices and zones of an event. This module does not track availability:
-- that is inventory.

CREATE TABLE catalog.ticket_types (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id   uuid        NOT NULL REFERENCES events.events (id),
  name       text        NOT NULL CHECK (btrim(name) <> ''),
  zone       text        CHECK (btrim(zone) <> ''),
  -- Whole colones.
  price_crc  integer     NOT NULL CHECK (price_crc >= 0),
  -- Who the type is for. Staff and performer types are never sold.
  audience   text        NOT NULL DEFAULT 'public' CHECK (audience IN ('public', 'staff', 'performer')),
  entry_mode text        NOT NULL DEFAULT 'single_use' CHECK (entry_mode IN ('single_use', 'multi_scan')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, name),
  -- Invariant I1: only staff and performers may have multi-scan entry.
  CONSTRAINT ticket_types_multi_scan_not_public
    CHECK (entry_mode = 'single_use' OR audience IN ('staff', 'performer'))
);

-- ── Row Level Security ───────────────────────────────────────────────────────
ALTER TABLE catalog.ticket_types ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;

CREATE POLICY ticket_types_module_read ON catalog.ticket_types FOR SELECT USING (app.is_module_role());
CREATE POLICY ticket_types_module_write ON catalog.ticket_types TO passripple_owner_catalog
  USING (true) WITH CHECK (true);

-- Public types of events on sale are visible to everyone. An organizer sees and manages
-- the types of its organization's events while they can still change.
CREATE POLICY ticket_types_api_read ON catalog.ticket_types FOR SELECT TO passripple_api
  USING (EXISTS (
    SELECT 1 FROM events.events e
     WHERE e.id = ticket_types.event_id
       AND ((SELECT app.actor_role()) = 'admin'
            OR ((SELECT app.actor_role()) = 'organizer' AND e.org_id = (SELECT app.org_id()))
            OR (e.status = 'on_sale' AND ticket_types.audience = 'public'))));
CREATE POLICY ticket_types_api_insert ON catalog.ticket_types FOR INSERT TO passripple_api
  WITH CHECK ((SELECT app.actor_role()) = 'organizer' AND EXISTS (
    SELECT 1 FROM events.events e
     WHERE e.id = ticket_types.event_id AND e.org_id = (SELECT app.org_id())
       AND e.status IN ('draft', 'pending_auth', 'on_sale')));
CREATE POLICY ticket_types_api_update ON catalog.ticket_types FOR UPDATE TO passripple_api
  USING ((SELECT app.actor_role()) = 'organizer' AND EXISTS (
    SELECT 1 FROM events.events e
     WHERE e.id = ticket_types.event_id AND e.org_id = (SELECT app.org_id())
       AND e.status IN ('draft', 'pending_auth', 'on_sale')))
  WITH CHECK ((SELECT app.actor_role()) = 'organizer' AND EXISTS (
    SELECT 1 FROM events.events e
     WHERE e.id = ticket_types.event_id AND e.org_id = (SELECT app.org_id())));
-- Types can be removed only before the event goes on sale.
CREATE POLICY ticket_types_api_delete ON catalog.ticket_types FOR DELETE TO passripple_api
  USING ((SELECT app.actor_role()) = 'organizer' AND EXISTS (
    SELECT 1 FROM events.events e
     WHERE e.id = ticket_types.event_id AND e.org_id = (SELECT app.org_id())
       AND e.status IN ('draft', 'pending_auth')));

GRANT USAGE ON SCHEMA catalog TO passripple_api;
GRANT SELECT,
      INSERT (event_id, name, zone, price_crc, audience, entry_mode),
      UPDATE (name, zone, price_crc),
      DELETE
  ON catalog.ticket_types TO passripple_api;
