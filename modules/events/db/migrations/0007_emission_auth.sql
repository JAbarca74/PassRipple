-- Municipal authorization of the emission (Phase 8, design 12.2 and 12.3). A canton that
-- accepts digital tickets (jurisdictions.accepts_digital = 'yes') must authorize the event
-- before it goes on sale. Where it is "unknown" or "no" the paper process continues and
-- publishing does not wait for anything here.
--
-- The authorization itself is decided in the municipal module. Its reference lands here,
-- through set_emission_auth, so that publishing can check it without depending upward.

-- The organizer asks for the authorization: the event waits in pending_auth.
CREATE FUNCTION events.request_authorization(p_event_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_event events.events := events.lock_for_change(p_event_id, '{}');
BEGIN
  IF v_event.status NOT IN ('draft', 'pending_auth') THEN
    RAISE EXCEPTION 'event % is %, so it cannot ask for authorization', p_event_id, v_event.status
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  UPDATE events.events SET status = 'pending_auth' WHERE id = p_event_id;
END
$$;

-- Records the reference of the authorization. Who may:
--   an official of the event's canton (the municipality's own decision);
--   an administrator;
--   the organizer, only where the canton does not accept digital tickets (the "document"
--   variant: the organizer loads the authorization from the canton's usual process).
-- An empty reference clears it, which is how a revoked authorization is withdrawn.
CREATE FUNCTION events.set_emission_auth(p_event_id uuid, p_reference text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_event   events.events;
  v_role    text := app.actor_role();
  v_allowed boolean := false;
BEGIN
  SELECT * INTO v_event FROM events.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'event % is not available to this actor', p_event_id USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_role = 'admin' THEN
    v_allowed := true;
  ELSIF v_role = 'inspector' THEN
    v_allowed := EXISTS (SELECT 1 FROM identity.inspectors i
                          WHERE i.user_id = app.actor_id() AND i.revoked_at IS NULL
                            AND i.kind = 'official' AND i.canton_code = v_event.canton_code);
  ELSIF v_role = 'organizer' THEN
    v_allowed := v_event.org_id = app.org_id()
                 AND EXISTS (SELECT 1 FROM jurisdictions.jurisdictions j
                              WHERE j.canton_code = v_event.canton_code AND j.accepts_digital <> 'yes');
  END IF;
  IF NOT coalesce(v_allowed, false) THEN
    RAISE EXCEPTION 'event % is not available to this actor', p_event_id USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_event.status NOT IN ('draft', 'pending_auth', 'on_sale') THEN
    RAISE EXCEPTION 'event % is %, so its authorization cannot change', p_event_id, v_event.status
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;

  UPDATE events.events SET emission_auth = nullif(btrim(p_reference), '') WHERE id = p_event_id;
END
$$;

-- The municipality turns an authorization down: the event goes back to draft so the
-- organizer can fix it and ask again.
CREATE FUNCTION events.reject_authorization(p_event_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_event events.events;
BEGIN
  SELECT * INTO v_event FROM events.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND
     OR NOT coalesce(app.actor_role() = 'admin'
                     OR (app.actor_role() = 'inspector'
                         AND EXISTS (SELECT 1 FROM identity.inspectors i
                                      WHERE i.user_id = app.actor_id() AND i.revoked_at IS NULL
                                        AND i.kind = 'official' AND i.canton_code = v_event.canton_code)),
                     false) THEN
    RAISE EXCEPTION 'event % is not available to this actor', p_event_id USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_event.status <> 'pending_auth' THEN
    RAISE EXCEPTION 'event % is %, so it has no authorization to reject', p_event_id, v_event.status
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  UPDATE events.events SET status = 'draft' WHERE id = p_event_id;
END
$$;

-- The publishing gate, now with the municipal authorization.
CREATE OR REPLACE FUNCTION events.publish(p_event_id uuid)
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
  IF v_event.emission_auth IS NULL
     AND EXISTS (SELECT 1 FROM jurisdictions.jurisdictions j
                  WHERE j.canton_code = v_event.canton_code AND j.accepts_digital = 'yes') THEN
    RAISE EXCEPTION 'the municipality has not authorized the emission'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  UPDATE events.events SET status = 'on_sale', published_at = now() WHERE id = p_event_id;
END
$$;

GRANT EXECUTE ON FUNCTION events.request_authorization(uuid) TO passripple_api;
GRANT EXECUTE ON FUNCTION events.set_emission_auth(uuid, text) TO passripple_api;
GRANT EXECUTE ON FUNCTION events.reject_authorization(uuid) TO passripple_api;
