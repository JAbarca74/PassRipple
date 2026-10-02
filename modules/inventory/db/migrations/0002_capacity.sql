-- Invariant I2: committed tickets (held + issued, sold + complimentary + door sales) never
-- exceed the permitted capacity. The counter lives here, one row per event, next to this
-- module's own copy of the permitted capacity (ADR 0004). The conditional UPDATE in
-- inventory.hold is the first safety net; the CHECK on the row is the second.

CREATE TABLE inventory.event_capacity (
  event_id           uuid        PRIMARY KEY REFERENCES events.events (id),
  -- Copy of events.events.permitted_capacity, kept by event.published and event.updated.
  permitted_capacity integer     NOT NULL CHECK (permitted_capacity > 0),
  committed          integer     NOT NULL DEFAULT 0 CHECK (committed >= 0),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_capacity_within_permit CHECK (committed <= permitted_capacity)
);

-- A hold commits capacity until it is released, expires or becomes issued tickets.
CREATE TABLE inventory.holds (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id       uuid        NOT NULL REFERENCES inventory.event_capacity (event_id),
  ticket_type_id uuid        NOT NULL REFERENCES catalog.ticket_types (id),
  quantity       integer     NOT NULL CHECK (quantity > 0),
  created_at     timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL,
  ended_at       timestamptz,
  -- released and expired give the capacity back; converted keeps it, as issued tickets.
  end_reason     text        CHECK (end_reason IN ('released', 'expired', 'converted')),
  CHECK ((ended_at IS NULL) = (end_reason IS NULL)),
  CHECK (expires_at > created_at)
);
CREATE INDEX holds_event_idx ON inventory.holds (event_id);
CREATE INDEX holds_active_expiry_idx ON inventory.holds (expires_at) WHERE ended_at IS NULL;

-- A permitted capacity lowered below what is already committed is refused by the CHECK
-- and recorded here for a person to resolve. Append-only.
CREATE TABLE inventory.capacity_incidents (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id           uuid        NOT NULL REFERENCES inventory.event_capacity (event_id),
  requested_capacity integer     NOT NULL,
  committed          integer     NOT NULL,
  kept_capacity      integer     NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX capacity_incidents_event_idx ON inventory.capacity_incidents (event_id);

CREATE TRIGGER capacity_incidents_append_only BEFORE UPDATE OR DELETE ON inventory.capacity_incidents
  FOR EACH ROW EXECUTE FUNCTION app.reject_mutation();
CREATE TRIGGER capacity_incidents_no_truncate BEFORE TRUNCATE ON inventory.capacity_incidents
  FOR EACH STATEMENT EXECUTE FUNCTION app.reject_mutation();

-- ── Row Level Security ───────────────────────────────────────────────────────
-- The API never writes these tables: every change goes through the functions below.
ALTER TABLE inventory.event_capacity     ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
ALTER TABLE inventory.holds              ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
ALTER TABLE inventory.capacity_incidents ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;

CREATE POLICY event_capacity_module_read ON inventory.event_capacity FOR SELECT USING (app.is_module_role());
CREATE POLICY event_capacity_module_write ON inventory.event_capacity TO passripple_owner_inventory
  USING (true) WITH CHECK (true);
CREATE POLICY holds_module_read ON inventory.holds FOR SELECT USING (app.is_module_role());
CREATE POLICY holds_module_write ON inventory.holds TO passripple_owner_inventory
  USING (true) WITH CHECK (true);
CREATE POLICY capacity_incidents_module_read ON inventory.capacity_incidents FOR SELECT
  USING (app.is_module_role());
CREATE POLICY capacity_incidents_module_write ON inventory.capacity_incidents TO passripple_owner_inventory
  USING (true) WITH CHECK (true);

-- Organizers see the counter and incidents of their organization's events.
CREATE POLICY event_capacity_api_read ON inventory.event_capacity FOR SELECT TO passripple_api
  USING ((SELECT app.actor_role()) = 'admin' OR EXISTS (
    SELECT 1 FROM events.events e
     WHERE e.id = event_capacity.event_id
       AND (SELECT app.actor_role()) = 'organizer' AND e.org_id = (SELECT app.org_id())));
CREATE POLICY capacity_incidents_api_read ON inventory.capacity_incidents FOR SELECT TO passripple_api
  USING ((SELECT app.actor_role()) = 'admin' OR EXISTS (
    SELECT 1 FROM events.events e
     WHERE e.id = capacity_incidents.event_id
       AND (SELECT app.actor_role()) = 'organizer' AND e.org_id = (SELECT app.org_id())));

GRANT USAGE ON SCHEMA inventory TO passripple_api;
GRANT SELECT ON inventory.event_capacity, inventory.capacity_incidents TO passripple_api;

-- ── Event handlers (ADR 0010) ────────────────────────────────────────────────
-- event.published: creates the counter with a copy of the permitted capacity. Reads the
-- event itself rather than trusting a payload, so a late or repeated delivery is harmless.
CREATE FUNCTION inventory.apply_event_published(p_event_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_capacity integer;
BEGIN
  IF app.actor_role() IS DISTINCT FROM 'system' THEN
    RAISE EXCEPTION 'only the system applies domain events' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT e.permitted_capacity INTO v_capacity
    FROM events.events e WHERE e.id = p_event_id AND e.published_at IS NOT NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'event % has not been published', p_event_id
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  INSERT INTO inventory.event_capacity (event_id, permitted_capacity)
  VALUES (p_event_id, v_capacity)
  ON CONFLICT (event_id) DO NOTHING;
END
$$;

-- event.updated: copies the permitted capacity again. A capacity below what is already
-- committed is refused by the CHECK, the copy is kept, and an incident is recorded.
-- Returns whether the copy now matches the permit.
CREATE FUNCTION inventory.apply_event_updated(p_event_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_requested integer;
  v_counter   inventory.event_capacity;
BEGIN
  IF app.actor_role() IS DISTINCT FROM 'system' THEN
    RAISE EXCEPTION 'only the system applies domain events' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT e.permitted_capacity INTO v_requested FROM events.events e WHERE e.id = p_event_id;
  SELECT * INTO v_counter FROM inventory.event_capacity c WHERE c.event_id = p_event_id FOR UPDATE;
  IF v_requested IS NULL OR v_counter.event_id IS NULL THEN
    -- Not published yet: event.published will copy the capacity.
    RETURN false;
  END IF;

  BEGIN
    UPDATE inventory.event_capacity
       SET permitted_capacity = v_requested, updated_at = now()
     WHERE event_id = p_event_id AND permitted_capacity <> v_requested;
  EXCEPTION WHEN check_violation THEN
    INSERT INTO inventory.capacity_incidents (event_id, requested_capacity, committed, kept_capacity)
    VALUES (p_event_id, v_requested, v_counter.committed, v_counter.permitted_capacity);
    RETURN false;
  END;
  RETURN true;
END
$$;

-- ── Holds ────────────────────────────────────────────────────────────────────
-- Commits capacity for a checkout. One conditional UPDATE on the event's row: no row
-- returned means no capacity left, or the event is not on sale. Contention is limited to
-- that one event. Returns the hold id, or NULL when there is no capacity.
CREATE FUNCTION inventory.hold(
  p_event_id uuid, p_ticket_type_id uuid, p_quantity integer, p_ttl interval DEFAULT interval '30 minutes'
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_hold_id uuid;
BEGIN
  IF NOT coalesce(app.actor_role() IN ('buyer', 'system'), false) THEN
    RAISE EXCEPTION 'this actor cannot hold tickets' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'quantity must be positive' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_ttl IS NULL OR p_ttl <= interval '0' OR p_ttl > interval '1 day' THEN
    RAISE EXCEPTION 'a hold lasts more than zero and at most one day' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM catalog.ticket_types t
                  WHERE t.id = p_ticket_type_id AND t.event_id = p_event_id AND t.audience = 'public') THEN
    RAISE EXCEPTION 'ticket type % is not on sale for event %', p_ticket_type_id, p_event_id
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  UPDATE inventory.event_capacity c
     SET committed = c.committed + p_quantity, updated_at = now()
    FROM events.events e
   WHERE c.event_id = p_event_id
     AND e.id = c.event_id
     AND e.status = 'on_sale'
     AND c.committed + p_quantity <= c.permitted_capacity;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  INSERT INTO inventory.holds (event_id, ticket_type_id, quantity, expires_at)
  VALUES (p_event_id, p_ticket_type_id, p_quantity, now() + p_ttl)
  RETURNING id INTO v_hold_id;
  RETURN v_hold_id;
END
$$;

-- Ends an active hold and gives its capacity back. Ending a hold twice changes nothing.
CREATE FUNCTION inventory.end_hold(p_hold_id uuid, p_reason text, p_at timestamptz)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
  v_event_id uuid;
  v_quantity integer;
BEGIN
  UPDATE inventory.holds SET ended_at = p_at, end_reason = p_reason
   WHERE id = p_hold_id AND ended_at IS NULL
  RETURNING event_id, quantity INTO v_event_id, v_quantity;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  IF p_reason IN ('released', 'expired') THEN
    UPDATE inventory.event_capacity
       SET committed = committed - v_quantity, updated_at = now()
     WHERE event_id = v_event_id;
  END IF;
  RETURN true;
END
$$;

-- The buyer abandons the checkout. Returns false if the hold had already ended.
CREATE FUNCTION inventory.release_hold(p_hold_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF NOT coalesce(app.actor_role() IN ('buyer', 'system'), false) THEN
    RAISE EXCEPTION 'this actor cannot release holds' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN inventory.end_hold(p_hold_id, 'released', now());
END
$$;

-- Ends every hold whose time is up and gives the capacity back. Run on a schedule.
-- Returns how many holds expired.
CREATE FUNCTION inventory.expire_holds(p_now timestamptz DEFAULT now())
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_hold  uuid;
  v_count integer := 0;
BEGIN
  IF app.actor_role() IS DISTINCT FROM 'system' THEN
    RAISE EXCEPTION 'only the system expires holds' USING ERRCODE = 'insufficient_privilege';
  END IF;
  FOR v_hold IN
    SELECT id FROM inventory.holds
     WHERE ended_at IS NULL AND expires_at <= p_now
     ORDER BY event_id
       FOR UPDATE SKIP LOCKED
  LOOP
    IF inventory.end_hold(v_hold, 'expired', p_now) THEN
      v_count := v_count + 1;
    END IF;
  END LOOP;
  RETURN v_count;
END
$$;

-- The hold became issued tickets: it ends but keeps its capacity. Called by orders when
-- an order is paid; the API cannot call it. Returns false if the hold had already ended,
-- for example because it expired before the payment arrived.
CREATE FUNCTION inventory.convert_hold(p_hold_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  RETURN inventory.end_hold(p_hold_id, 'converted', now());
END
$$;

GRANT EXECUTE ON FUNCTION inventory.apply_event_published(uuid) TO passripple_api;
GRANT EXECUTE ON FUNCTION inventory.apply_event_updated(uuid) TO passripple_api;
GRANT EXECUTE ON FUNCTION inventory.hold(uuid, uuid, integer, interval) TO passripple_api;
GRANT EXECUTE ON FUNCTION inventory.release_hold(uuid) TO passripple_api;
GRANT EXECUTE ON FUNCTION inventory.expire_holds(timestamptz) TO passripple_api;
