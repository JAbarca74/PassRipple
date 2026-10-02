-- The event: venue, canton, date, age rating, permitted capacity and permit, and the
-- publishing gate. This module knows nothing about prices or sales. The capacity counter
-- that enforces I2 lives in inventory (ADR 0004); permitted_capacity here is the permit.

CREATE TABLE events.events (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid        NOT NULL REFERENCES identity.organizations (id),
  canton_code        text        NOT NULL REFERENCES jurisdictions.jurisdictions (canton_code),
  name               text        NOT NULL CHECK (btrim(name) <> ''),
  venue_name         text        NOT NULL CHECK (btrim(venue_name) <> ''),
  starts_at          timestamptz NOT NULL,
  age_rating         text        NOT NULL CHECK (age_rating IN ('all', '12plus', '18plus')),
  permitted_capacity integer     NOT NULL CHECK (permitted_capacity > 0),
  permit_number      text        CHECK (btrim(permit_number) <> ''),
  permit_doc_url     text,
  -- Reference of the municipal authorization to issue tickets.
  emission_auth      text,
  status             text        NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft', 'pending_auth', 'on_sale', 'closed', 'cancelled')),
  published_at       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (status NOT IN ('on_sale', 'closed') OR published_at IS NOT NULL)
);
CREATE INDEX events_org_idx ON events.events (org_id);
CREATE INDEX events_canton_idx ON events.events (canton_code);

-- ── Row Level Security ───────────────────────────────────────────────────────
ALTER TABLE events.events ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;

CREATE POLICY events_module_read ON events.events FOR SELECT USING (app.is_module_role());
CREATE POLICY events_module_write ON events.events TO passripple_owner_events
  USING (true) WITH CHECK (true);

-- Events on sale are public. An organizer sees every event of the organization it acts
-- for; an administrator sees every event.
CREATE POLICY events_api_read ON events.events FOR SELECT TO passripple_api
  USING (status = 'on_sale'
         OR (SELECT app.actor_role()) = 'admin'
         OR ((SELECT app.actor_role()) = 'organizer' AND org_id = (SELECT app.org_id())));
CREATE POLICY events_api_insert ON events.events FOR INSERT TO passripple_api
  WITH CHECK ((SELECT app.actor_role()) = 'organizer' AND org_id = (SELECT app.org_id())
              AND status = 'draft');
-- Closed and cancelled events are final. Status only changes through the functions below.
CREATE POLICY events_api_update ON events.events FOR UPDATE TO passripple_api
  USING ((SELECT app.actor_role()) = 'organizer' AND org_id = (SELECT app.org_id())
         AND status IN ('draft', 'pending_auth', 'on_sale'))
  WITH CHECK ((SELECT app.actor_role()) = 'organizer' AND org_id = (SELECT app.org_id()));

GRANT USAGE ON SCHEMA events TO passripple_api;
GRANT SELECT,
      INSERT (org_id, canton_code, name, venue_name, starts_at, age_rating, permitted_capacity,
              permit_number, permit_doc_url),
      UPDATE (canton_code, name, venue_name, starts_at, age_rating, permitted_capacity,
              permit_number, permit_doc_url)
  ON events.events TO passripple_api;

-- ── Status changes ───────────────────────────────────────────────────────────
-- Locks the event and checks that the actor may change it: an organizer of its
-- organization, or one of the extra roles allowed. Unknown events and other
-- organizations' events get the same error, so the error reveals nothing.
CREATE FUNCTION events.lock_for_change(p_event_id uuid, p_extra_roles text[])
RETURNS events.events
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
  v_event events.events;
BEGIN
  SELECT * INTO v_event FROM events.events WHERE id = p_event_id FOR UPDATE;
  -- coalesce: with no actor set the comparison is NULL, which must deny, not allow.
  IF NOT FOUND
     OR NOT coalesce((app.actor_role() = 'organizer' AND v_event.org_id = app.org_id())
                     OR app.actor_role() = ANY (p_extra_roles), false) THEN
    RAISE EXCEPTION 'event % is not available to this actor', p_event_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN v_event;
END
$$;

-- The publishing gate: an event goes on sale only if its organization is verified and
-- its permit number is recorded. The API then emits event.published.
CREATE FUNCTION events.publish(p_event_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_event events.events := events.lock_for_change(p_event_id, '{}');
BEGIN
  IF v_event.status NOT IN ('draft', 'pending_auth') THEN
    RAISE EXCEPTION 'event % is %, so it cannot be published', p_event_id, v_event.status
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM identity.organizations o
                  WHERE o.id = v_event.org_id AND o.verified_at IS NOT NULL) THEN
    RAISE EXCEPTION 'the organization is not verified' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF v_event.permit_number IS NULL THEN
    RAISE EXCEPTION 'the event has no permit number' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  UPDATE events.events SET status = 'on_sale', published_at = now() WHERE id = p_event_id;
END
$$;

-- Ends sales. The API then emits event.updated.
CREATE FUNCTION events.close(p_event_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_event events.events := events.lock_for_change(p_event_id, '{admin,system}');
BEGIN
  IF v_event.status <> 'on_sale' THEN
    RAISE EXCEPTION 'event % is %, so it cannot be closed', p_event_id, v_event.status
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  UPDATE events.events SET status = 'closed' WHERE id = p_event_id;
END
$$;

-- Cancels an event that has not closed. The API then emits event.cancelled.
CREATE FUNCTION events.cancel(p_event_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_event events.events := events.lock_for_change(p_event_id, '{admin}');
BEGIN
  IF v_event.status IN ('closed', 'cancelled') THEN
    RAISE EXCEPTION 'event % is %, so it cannot be cancelled', p_event_id, v_event.status
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  UPDATE events.events SET status = 'cancelled' WHERE id = p_event_id;
END
$$;

GRANT EXECUTE ON FUNCTION events.publish(uuid) TO passripple_api;
GRANT EXECUTE ON FUNCTION events.close(uuid) TO passripple_api;
GRANT EXECUTE ON FUNCTION events.cancel(uuid) TO passripple_api;
