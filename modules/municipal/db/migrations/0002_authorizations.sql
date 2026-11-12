-- Municipal oversight (Phase 8, design 12). This module only reads the domain: its own data
-- is the authorization of each event's emission. Everything is a SECURITY DEFINER function
-- because the API role has no direct access to the tables below, and each function decides
-- who may call it:
--   official   a municipal account with kind 'official' in the event's canton
--   inspector  any municipal account in the event's canton (official or inspector)
--   organizer  the organization that owns the event
--   admin      the platform administrator
-- Where the authorization is recorded for publishing (events.emission_auth) it goes through
-- the events module's own functions, which repeat the check (defense in depth).

CREATE TABLE municipal.authorizations (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id     uuid        NOT NULL REFERENCES events.events (id),
  canton_code  text        NOT NULL,
  -- portal: the municipality decides here. document: the organizer loaded the authorization
  -- from the canton's usual process.
  mode         text        NOT NULL CHECK (mode IN ('portal', 'document')),
  status       text        NOT NULL CHECK (status IN ('requested', 'authorized', 'rejected')),
  reference    text        CHECK (btrim(reference) <> ''),
  notes        text,
  requested_by uuid        NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_by   uuid,
  decided_at   timestamptz,
  -- The canton's rules when it decided (open question of design 18: copy, do not version),
  -- and the guarantee computed on the authorized emission.
  rules         jsonb,
  guarantee_crc integer     CHECK (guarantee_crc >= 0),
  CHECK (status = 'requested' OR decided_at IS NOT NULL),
  CHECK (status <> 'authorized' OR reference IS NOT NULL)
);
CREATE UNIQUE INDEX authorizations_one_open_idx ON municipal.authorizations (event_id) WHERE status = 'requested';
CREATE UNIQUE INDEX authorizations_one_authorized_idx ON municipal.authorizations (event_id) WHERE status = 'authorized';
CREATE INDEX authorizations_canton_idx ON municipal.authorizations (canton_code, requested_at DESC);

ALTER TABLE municipal.authorizations ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
CREATE POLICY authorizations_module ON municipal.authorizations TO passripple_owner_municipal
  USING (true) WITH CHECK (true);

-- ── Who may ──────────────────────────────────────────────────────────────────

-- True when the actor is an administrator, or holds municipal access in the canton ("official"
-- access when p_official). Organizers are not municipal: they have their own checks.
CREATE FUNCTION municipal.in_scope(p_canton_code text, p_official boolean)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT coalesce(
    app.actor_role() = 'admin'
    OR (app.actor_role() = 'inspector'
        AND EXISTS (SELECT 1 FROM identity.inspectors i
                     WHERE i.user_id = app.actor_id() AND i.revoked_at IS NULL
                       AND i.canton_code = p_canton_code
                       AND (NOT p_official OR i.kind = 'official'))),
    false)
$$;

-- Whether the actor may see this event's municipal figures.
CREATE FUNCTION municipal.can_view(p_event_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT coalesce((
    SELECT municipal.in_scope(e.canton_code, false)
           OR (app.actor_role() = 'organizer' AND e.org_id = app.org_id())
      FROM events.events e WHERE e.id = p_event_id), false)
$$;

CREATE FUNCTION municipal.require_view(p_event_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF NOT municipal.can_view(p_event_id) THEN
    -- The same error for an unknown event and for one of another canton or organization.
    RAISE EXCEPTION 'event % is not available to this actor', p_event_id USING ERRCODE = 'insufficient_privilege';
  END IF;
END
$$;

-- ── Estimates ────────────────────────────────────────────────────────────────

-- The tax the authorized emission could produce at most: the permitted capacity at the average
-- price of the public ticket types, at the canton's rate.
CREATE FUNCTION municipal.estimated_tax_crc(p_event_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT coalesce(round(e.permitted_capacity::numeric
           * (SELECT coalesce(avg(t.price_crc), 0) FROM catalog.ticket_types t
               WHERE t.event_id = e.id AND t.audience = 'public')
           * j.tax_rate_bps / 10000), 0)::integer
    FROM events.events e JOIN jurisdictions.jurisdictions j ON j.canton_code = e.canton_code
   WHERE e.id = p_event_id
$$;

-- ── Authorization ────────────────────────────────────────────────────────────

-- The organizer asks for the authorization. portal: the municipality will decide. document:
-- the organizer records the reference of the authorization from the canton's usual process,
-- only where the canton does not accept digital tickets (so no portal exists for it).
CREATE FUNCTION municipal.request_authorization(p_event_id uuid, p_mode text, p_reference text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_event   events.events;
  v_digital text;
  v_id      uuid;
  v_ref     text := nullif(btrim(p_reference), '');
BEGIN
  IF app.actor_role() IS DISTINCT FROM 'organizer' THEN
    RAISE EXCEPTION 'only the organizer asks for an authorization' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_mode NOT IN ('portal', 'document') THEN
    RAISE EXCEPTION 'unknown mode "%"', p_mode USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO v_event FROM events.events e WHERE e.id = p_event_id AND e.org_id = app.org_id();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'event % is not available to this actor', p_event_id USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT j.accepts_digital INTO v_digital FROM jurisdictions.jurisdictions j WHERE j.canton_code = v_event.canton_code;
  IF v_event.status NOT IN ('draft', 'pending_auth') THEN
    RAISE EXCEPTION 'event % is %, so it cannot ask for authorization', p_event_id, v_event.status
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF EXISTS (SELECT 1 FROM municipal.authorizations a
              WHERE a.event_id = p_event_id AND a.status IN ('requested', 'authorized')) THEN
    RAISE EXCEPTION 'event % already has an authorization in progress or granted', p_event_id
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;

  IF p_mode = 'portal' THEN
    IF v_digital = 'no' THEN
      RAISE EXCEPTION 'canton % does not accept digital tickets', v_event.canton_code
        USING ERRCODE = 'object_not_in_prerequisite_state';
    END IF;
    PERFORM events.request_authorization(p_event_id);
    INSERT INTO municipal.authorizations (event_id, canton_code, mode, status, requested_by)
    VALUES (p_event_id, v_event.canton_code, 'portal', 'requested', app.actor_id())
    RETURNING id INTO v_id;
  ELSE
    IF v_digital = 'yes' THEN
      RAISE EXCEPTION 'canton % authorizes through the portal', v_event.canton_code
        USING ERRCODE = 'object_not_in_prerequisite_state';
    END IF;
    IF v_ref IS NULL THEN
      RAISE EXCEPTION 'the reference of the authorization is required' USING ERRCODE = 'invalid_parameter_value';
    END IF;
    PERFORM events.set_emission_auth(p_event_id, v_ref);
    INSERT INTO municipal.authorizations (event_id, canton_code, mode, status, reference, requested_by,
                                          decided_by, decided_at)
    VALUES (p_event_id, v_event.canton_code, 'document', 'authorized', v_ref, app.actor_id(),
            app.actor_id(), now())
    RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END
$$;

-- An official decides. Approving copies the canton's rules, computes the guarantee and
-- records the reference on the event. Rejecting sends the event back to draft. Returns the
-- reference when approved.
CREATE FUNCTION municipal.decide(p_authorization_id uuid, p_approve boolean, p_notes text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_auth  municipal.authorizations;
  v_rules jsonb;
  v_ref   text;
  v_guar  integer;
BEGIN
  SELECT * INTO v_auth FROM municipal.authorizations WHERE id = p_authorization_id FOR UPDATE;
  IF NOT FOUND OR NOT municipal.in_scope(v_auth.canton_code, true) THEN
    RAISE EXCEPTION 'authorization % is not available to this actor', p_authorization_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_auth.status <> 'requested' THEN
    RAISE EXCEPTION 'authorization % is already %', p_authorization_id, v_auth.status
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;

  IF p_approve THEN
    SELECT jsonb_build_object('taxRateBps', j.tax_rate_bps, 'courtesyDeductBps', j.courtesy_deduct_bps,
                              'settlementRule', j.settlement_rule, 'guaranteeBps', j.guarantee_bps,
                              'reportFormat', j.report_format)
      INTO v_rules
      FROM jurisdictions.jurisdictions j WHERE j.canton_code = v_auth.canton_code;
    v_guar := round(municipal.estimated_tax_crc(v_auth.event_id)::numeric
                    * coalesce((v_rules ->> 'guaranteeBps')::integer, 0) / 10000)::integer;
    v_ref := 'AUT-' || upper(v_auth.canton_code) || '-' || to_char(now(), 'YYYY') || '-'
             || upper(substr(replace(v_auth.id::text, '-', ''), 1, 8));
    PERFORM events.set_emission_auth(v_auth.event_id, v_ref);
    UPDATE municipal.authorizations
       SET status = 'authorized', reference = v_ref, notes = nullif(btrim(p_notes), ''),
           decided_by = app.actor_id(), decided_at = now(), rules = v_rules, guarantee_crc = v_guar
     WHERE id = p_authorization_id;
    RETURN v_ref;
  END IF;

  PERFORM events.reject_authorization(v_auth.event_id);
  UPDATE municipal.authorizations
     SET status = 'rejected', notes = nullif(btrim(p_notes), ''),
         decided_by = app.actor_id(), decided_at = now()
   WHERE id = p_authorization_id;
  RETURN NULL;
END
$$;

-- ── Counts, courtesies and the declaration ───────────────────────────────────

-- The live count of an event (12.2, "conteo de talonarios"), always from the domain's own
-- tables, never a cached figure.
CREATE FUNCTION municipal.live_counts(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  PERFORM municipal.require_view(p_event_id);
  RETURN (
    SELECT jsonb_build_object(
      'capacity', e.permitted_capacity,
      'issued', count(t.id) FILTER (WHERE t.status IN ('issued', 'bound')),
      'soldOnline', count(t.id) FILTER (WHERE t.origin = 'sale' AND t.status <> 'void'),
      'doorSales', count(t.id) FILTER (WHERE t.origin = 'door_sale' AND t.status IN ('issued', 'bound')),
      'courtesies', count(t.id) FILTER (WHERE t.origin = 'courtesy' AND t.status <> 'void'),
      'redeemed', (SELECT count(DISTINCT r.ticket_id) FROM redemption.redemptions r
                    JOIN ticketing.tickets rt ON rt.id = r.ticket_id
                   WHERE rt.event_id = e.id AND r.outcome = 'admitted'),
      'voided', count(t.id) FILTER (WHERE t.status = 'void' AND t.origin IN ('sale', 'courtesy')))
    FROM events.events e LEFT JOIN ticketing.tickets t ON t.event_id = e.id
   WHERE e.id = p_event_id
   GROUP BY e.id);
END
$$;

-- The deductible courtesies (12.1, 12.2): the canton's limit is a share of the entries, and
-- what goes over it is taxed. Without a limit in the rules nothing is flagged. The rules
-- used are the ones copied at authorization, when there is one. The stricter share is used
-- when the canton sets one per category (the tickets have no category yet).
CREATE FUNCTION municipal.courtesy_deductible(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_deduct jsonb;
  v_bps    integer;
  v_total  integer;
  v_court  integer;
  v_limit  integer;
BEGIN
  PERFORM municipal.require_view(p_event_id);
  SELECT coalesce((SELECT a.rules -> 'courtesyDeductBps' FROM municipal.authorizations a
                    WHERE a.event_id = e.id AND a.status = 'authorized' AND a.rules IS NOT NULL),
                  j.courtesy_deduct_bps)
    INTO v_deduct
    FROM events.events e JOIN jurisdictions.jurisdictions j ON j.canton_code = e.canton_code
   WHERE e.id = p_event_id;
  SELECT min(value::integer) INTO v_bps FROM jsonb_each_text(v_deduct);
  SELECT count(*) FILTER (WHERE status IN ('issued', 'bound')),
         count(*) FILTER (WHERE origin = 'courtesy' AND status <> 'void')
    INTO v_total, v_court
    FROM ticketing.tickets WHERE event_id = p_event_id;
  IF v_bps IS NULL THEN
    RETURN jsonb_build_object('courtesies', v_court, 'entries', v_total, 'deductBps', NULL,
                              'limit', NULL, 'excess', 0);
  END IF;
  v_limit := floor(v_total::numeric * v_bps / 10000)::integer;
  RETURN jsonb_build_object('courtesies', v_court, 'entries', v_total, 'deductBps', v_bps,
                            'limit', v_limit, 'excess', greatest(v_court - v_limit, 0));
END
$$;

-- The hash of the event's record (12.4): every ticket and every admission, in a fixed order.
-- Any change after the declaration, an added or a deleted row, gives a different hash.
CREATE FUNCTION municipal.log_hash(p_event_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_tickets text;
  v_scans   text;
BEGIN
  PERFORM municipal.require_view(p_event_id);
  SELECT coalesce(string_agg(concat_ws('|', t.id, t.ticket_type_id, t.origin, t.status), E'\n' ORDER BY t.id), '')
    INTO v_tickets FROM ticketing.tickets t WHERE t.event_id = p_event_id;
  SELECT coalesce(string_agg(concat_ws('|', r.id, r.ticket_id, r.device_id, r.device_seq, r.outcome), E'\n' ORDER BY r.id), '')
    INTO v_scans
    FROM redemption.redemptions r JOIN ticketing.tickets t ON t.id = r.ticket_id
   WHERE t.event_id = p_event_id;
  RETURN encode(sha256(convert_to(v_tickets || E'\n--\n' || v_scans, 'UTF8')), 'hex');
END
$$;

-- The raw figures of the declaration (12.4). The tax package turns them into the base, the
-- tax and the deadline; the money never passes through this platform.
CREATE FUNCTION municipal.declaration_figures(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_result jsonb;
BEGIN
  PERFORM municipal.require_view(p_event_id);
  SELECT jsonb_build_object(
    'event', jsonb_build_object(
      'id', e.id, 'name', e.name, 'venue', e.venue_name, 'startsAt', e.starts_at, 'endsAt', e.ends_at,
      'permitNumber', e.permit_number, 'emissionAuth', e.emission_auth, 'status', e.status,
      'permittedCapacity', e.permitted_capacity),
    'organization', o.name,
    'canton', jsonb_build_object('code', j.canton_code, 'name', j.name),
    'rules', coalesce((SELECT a.rules FROM municipal.authorizations a
                        WHERE a.event_id = e.id AND a.status = 'authorized' AND a.rules IS NOT NULL),
                      jsonb_build_object('taxRateBps', j.tax_rate_bps, 'courtesyDeductBps', j.courtesy_deduct_bps,
                                         'settlementRule', j.settlement_rule, 'guaranteeBps', j.guarantee_bps,
                                         'reportFormat', j.report_format)),
    'types', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'name', x.name, 'priceCrc', x.price_crc, 'audience', x.audience,
               'online', x.online, 'door', x.door, 'courtesies', x.courtesies,
               'redeemed', x.redeemed, 'voided', x.voided)
             ORDER BY x.price_crc DESC, x.name)
        FROM (
          SELECT tt.name, tt.price_crc, tt.audience,
                 count(t.id) FILTER (WHERE t.origin = 'sale' AND t.status <> 'void') AS online,
                 count(t.id) FILTER (WHERE t.origin = 'door_sale' AND t.status IN ('issued', 'bound')) AS door,
                 count(t.id) FILTER (WHERE t.origin = 'courtesy' AND t.status <> 'void') AS courtesies,
                 count(t.id) FILTER (WHERE EXISTS (SELECT 1 FROM redemption.redemptions r
                                                    WHERE r.ticket_id = t.id AND r.outcome = 'admitted')) AS redeemed,
                 count(t.id) FILTER (WHERE t.status = 'void' AND t.origin IN ('sale', 'courtesy')) AS voided
            FROM catalog.ticket_types tt
            LEFT JOIN ticketing.tickets t ON t.ticket_type_id = tt.id
           WHERE tt.event_id = e.id
           GROUP BY tt.id
        ) x), '[]'::jsonb),
    'duplicateScans', (SELECT count(*) FROM redemption.redemptions r JOIN ticketing.tickets t ON t.id = r.ticket_id
                        WHERE t.event_id = e.id AND r.outcome = 'duplicate'),
    'capacityIncidents', (SELECT count(*) FROM inventory.capacity_incidents ci WHERE ci.event_id = e.id),
    'courtesy', municipal.courtesy_deductible(e.id),
    'logHash', municipal.log_hash(e.id),
    'generatedAt', now())
    INTO v_result
    FROM events.events e
    JOIN identity.organizations o ON o.id = e.org_id
    JOIN jurisdictions.jurisdictions j ON j.canton_code = e.canton_code
   WHERE e.id = p_event_id;
  RETURN v_result;
END
$$;

-- ── Lists for the portal and the organizer ───────────────────────────────────

-- The authorizations the actor may see: a municipal account those of its cantons, an
-- organizer those of its events, an administrator all. Requests waiting come first.
CREATE FUNCTION municipal.authorizations_list()
RETURNS TABLE (
  authorization_id uuid, event_id uuid, event_name text, organization text, canton_code text,
  starts_at timestamptz, permit_number text, permitted_capacity integer, mode text, status text,
  reference text, notes text, requested_at timestamptz, decided_at timestamptz,
  estimated_tax_crc integer, guarantee_crc integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT a.id, e.id, e.name, o.name, a.canton_code, e.starts_at, e.permit_number, e.permitted_capacity,
         a.mode, a.status, a.reference, a.notes, a.requested_at, a.decided_at,
         municipal.estimated_tax_crc(e.id), a.guarantee_crc
    FROM municipal.authorizations a
    JOIN events.events e ON e.id = a.event_id
    JOIN identity.organizations o ON o.id = e.org_id
   WHERE municipal.can_view(e.id)
   ORDER BY (a.status = 'requested') DESC, a.requested_at DESC
$$;

-- The events of the actor's cantons with their live figures, for the inspector's board.
CREATE FUNCTION municipal.events_overview()
RETURNS TABLE (
  event_id uuid, name text, organization text, canton_code text, starts_at timestamptz,
  ends_at timestamptz, status text, emission_auth text, counts jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT e.id, e.name, o.name, e.canton_code, e.starts_at, e.ends_at, e.status, e.emission_auth,
         municipal.live_counts(e.id)
    FROM events.events e JOIN identity.organizations o ON o.id = e.org_id
   WHERE municipal.can_view(e.id) AND e.status <> 'draft'
   ORDER BY e.starts_at DESC, e.id
$$;

-- ── Inspector mode ───────────────────────────────────────────────────────────

-- Checks a ticket by its human code without admitting it (12.2, "modo inspector"). A code
-- that does not exist and one from another canton answer the same.
CREATE FUNCTION municipal.verify_ticket(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_ticket ticketing.tickets;
  v_name   text;
  v_type   text;
  v_admit  boolean;
BEGIN
  IF app.actor_role() NOT IN ('inspector', 'admin') THEN
    RAISE EXCEPTION 'only municipal accounts verify tickets' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT t.* INTO v_ticket FROM ticketing.tickets t
   WHERE t.code_human = upper(regexp_replace(coalesce(p_code, ''), '[\s-]', '', 'g'));
  IF NOT FOUND OR NOT municipal.can_view(v_ticket.event_id) THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'unknown');
  END IF;
  SELECT e.name INTO v_name FROM events.events e WHERE e.id = v_ticket.event_id;
  SELECT tt.name INTO v_type FROM catalog.ticket_types tt WHERE tt.id = v_ticket.ticket_type_id;
  v_admit := EXISTS (SELECT 1 FROM redemption.redemptions r
                      WHERE r.ticket_id = v_ticket.id AND r.outcome = 'admitted');
  RETURN jsonb_build_object(
    'valid', v_ticket.status IN ('issued', 'bound') AND NOT (v_admit AND v_ticket.entry_mode = 'single_use'),
    'reason', CASE WHEN v_ticket.status = 'void' THEN 'void'
                   WHEN v_ticket.status = 'unsold' THEN 'unsold'
                   WHEN v_admit AND v_ticket.entry_mode = 'single_use' THEN 'already_admitted'
                   ELSE 'ok' END,
    'eventId', v_ticket.event_id, 'eventName', v_name, 'ticketType', v_type,
    'origin', v_ticket.origin, 'admitted', v_admit);
END
$$;

GRANT EXECUTE ON FUNCTION municipal.request_authorization(uuid, text, text) TO passripple_api;
GRANT EXECUTE ON FUNCTION municipal.decide(uuid, boolean, text) TO passripple_api;
GRANT EXECUTE ON FUNCTION municipal.live_counts(uuid) TO passripple_api;
GRANT EXECUTE ON FUNCTION municipal.courtesy_deductible(uuid) TO passripple_api;
GRANT EXECUTE ON FUNCTION municipal.declaration_figures(uuid) TO passripple_api;
GRANT EXECUTE ON FUNCTION municipal.authorizations_list() TO passripple_api;
GRANT EXECUTE ON FUNCTION municipal.events_overview() TO passripple_api;
GRANT EXECUTE ON FUNCTION municipal.verify_ticket(text) TO passripple_api;
GRANT USAGE ON SCHEMA municipal TO passripple_api;
