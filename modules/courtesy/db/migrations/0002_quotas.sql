-- Invariant I3: complimentary tickets never exceed the event's declared quota. Like the
-- capacity counter, the quota is one row per event with a conditional UPDATE as the first
-- safety net and a CHECK as the second.
--
-- In Phase 0 a grant records the complimentary tickets against the quota. Issuing them
-- through ticketing, counting them against the event's capacity (I2) and reserving part
-- of the quota for offline devices arrive in Phase 7.

CREATE TABLE courtesy.event_quotas (
  event_id       uuid        PRIMARY KEY REFERENCES events.events (id),
  declared_quota integer     NOT NULL CHECK (declared_quota >= 0),
  granted        integer     NOT NULL DEFAULT 0 CHECK (granted >= 0),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_quotas_within_declared CHECK (granted <= declared_quota)
);

CREATE TABLE courtesy.grants (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id   uuid        NOT NULL REFERENCES courtesy.event_quotas (event_id),
  quantity   integer     NOT NULL CHECK (quantity > 0),
  -- The user who granted them (an identity user; no foreign key, this module does not
  -- depend on identity).
  granted_by uuid        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX grants_event_idx ON courtesy.grants (event_id);

CREATE TRIGGER grants_append_only BEFORE UPDATE OR DELETE ON courtesy.grants
  FOR EACH ROW EXECUTE FUNCTION app.reject_mutation();
CREATE TRIGGER grants_no_truncate BEFORE TRUNCATE ON courtesy.grants
  FOR EACH STATEMENT EXECUTE FUNCTION app.reject_mutation();

-- ── Row Level Security ───────────────────────────────────────────────────────
-- The API never writes these tables: it calls the functions below.
ALTER TABLE courtesy.event_quotas ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
ALTER TABLE courtesy.grants       ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;

CREATE POLICY event_quotas_module_read ON courtesy.event_quotas FOR SELECT USING (app.is_module_role());
CREATE POLICY event_quotas_module_write ON courtesy.event_quotas TO passripple_owner_courtesy
  USING (true) WITH CHECK (true);
CREATE POLICY grants_module_read ON courtesy.grants FOR SELECT USING (app.is_module_role());
CREATE POLICY grants_module_write ON courtesy.grants TO passripple_owner_courtesy
  USING (true) WITH CHECK (true);

CREATE POLICY event_quotas_api_read ON courtesy.event_quotas FOR SELECT TO passripple_api
  USING ((SELECT app.actor_role()) = 'admin' OR EXISTS (
    SELECT 1 FROM events.events e
     WHERE e.id = event_quotas.event_id
       AND (SELECT app.actor_role()) = 'organizer' AND e.org_id = (SELECT app.org_id())));
CREATE POLICY grants_api_read ON courtesy.grants FOR SELECT TO passripple_api
  USING ((SELECT app.actor_role()) = 'admin' OR EXISTS (
    SELECT 1 FROM events.events e
     WHERE e.id = grants.event_id
       AND (SELECT app.actor_role()) = 'organizer' AND e.org_id = (SELECT app.org_id())));

GRANT USAGE ON SCHEMA courtesy TO passripple_api;
GRANT SELECT ON courtesy.event_quotas, courtesy.grants TO passripple_api;

-- ── Functions ────────────────────────────────────────────────────────────────
-- True when the actor is an organizer of the event's organization and the event can
-- still change.
CREATE FUNCTION courtesy.actor_manages_event(p_event_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = pg_catalog
AS $$
  SELECT coalesce(app.actor_role() = 'organizer' AND EXISTS (
    SELECT 1 FROM events.events e
     WHERE e.id = p_event_id AND e.org_id = app.org_id()
       AND e.status IN ('draft', 'pending_auth', 'on_sale')), false);
$$;

-- Declares or changes the event's quota. A quota below what was already granted is
-- refused by the CHECK.
CREATE FUNCTION courtesy.declare_quota(p_event_id uuid, p_quota integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF NOT courtesy.actor_manages_event(p_event_id) THEN
    RAISE EXCEPTION 'event % is not available to this actor', p_event_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  INSERT INTO courtesy.event_quotas (event_id, declared_quota)
  VALUES (p_event_id, p_quota)
  ON CONFLICT (event_id) DO UPDATE
    SET declared_quota = excluded.declared_quota, updated_at = now();
EXCEPTION WHEN check_violation THEN
  RAISE EXCEPTION 'quota % is invalid or below what was already granted for event %', p_quota, p_event_id
    USING ERRCODE = 'check_violation';
END
$$;

-- Grants complimentary tickets against the quota with one conditional UPDATE of the
-- event's row. Returns the grant, or NULL when the quota has no room left.
CREATE FUNCTION courtesy.grant_tickets(p_event_id uuid, p_quantity integer)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_grant_id uuid;
BEGIN
  IF NOT courtesy.actor_manages_event(p_event_id) THEN
    RAISE EXCEPTION 'event % is not available to this actor', p_event_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'quantity must be positive' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  UPDATE courtesy.event_quotas
     SET granted = granted + p_quantity, updated_at = now()
   WHERE event_id = p_event_id
     AND granted + p_quantity <= declared_quota;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  INSERT INTO courtesy.grants (event_id, quantity, granted_by)
  VALUES (p_event_id, p_quantity, app.actor_id())
  RETURNING id INTO v_grant_id;
  RETURN v_grant_id;
END
$$;

GRANT EXECUTE ON FUNCTION courtesy.declare_quota(uuid, integer) TO passripple_api;
GRANT EXECUTE ON FUNCTION courtesy.grant_tickets(uuid, integer) TO passripple_api;
