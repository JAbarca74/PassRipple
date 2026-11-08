-- Receivers who left an email when claiming a ticket (ticketing 0008) prove it with the same
-- contact codes as buyers: a code is mailed when the address has orders or current claims,
-- recovery lists the claims the address still holds, and the access document lists every
-- ticket received with it.

CREATE OR REPLACE FUNCTION orders.request_contact_code(
  p_email text, p_purpose text, p_code_hash bytea, p_ttl interval
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF app.actor_role() IS DISTINCT FROM 'system' THEN
    RAISE EXCEPTION 'only the system records contact codes' USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- Serializes requests for one address, so the limit holds under concurrency.
  PERFORM pg_advisory_xact_lock(hashtextextended('orders.contact_codes/' || p_email, 0));
  IF (SELECT count(*) FROM orders.contact_codes
       WHERE contact_email = p_email AND created_at > now() - interval '15 minutes') >= 5 THEN
    RAISE EXCEPTION 'too many codes for this address' USING ERRCODE = 'PR429';
  END IF;
  INSERT INTO orders.contact_codes (contact_email, purpose, code_hash, expires_at)
  VALUES (p_email, p_purpose, p_code_hash, now() + p_ttl);
  RETURN EXISTS (SELECT 1 FROM orders.orders o WHERE o.contact_email = p_email)
      OR EXISTS (SELECT 1 FROM ticketing.transfers x WHERE x.holder_email = p_email);
END
$$;

-- Recovery after a used code: the claims of that address that still hold a live ticket.
-- The Worker draws a new receiver token for each and calls ticketing.recover_held.
CREATE FUNCTION orders.recoverable_held(p_code_id uuid)
RETURNS TABLE (transfer_id uuid, event_name text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
#variable_conflict use_column
BEGIN
  IF app.actor_role() IS DISTINCT FROM 'system' THEN
    RAISE EXCEPTION 'only the system recovers received tickets' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
    SELECT x.id, e.name
      FROM orders.contact_codes c
      JOIN ticketing.transfers x ON x.holder_email = c.contact_email
      JOIN ticketing.tickets t ON t.id = x.ticket_id
      JOIN events.events e ON e.id = t.event_id
     WHERE c.id = p_code_id AND c.purpose = 'recovery' AND c.used_at > now() - interval '5 minutes'
       AND t.status = 'bound' AND ticketing.is_current_claim(x.id)
     ORDER BY x.claimed_at;
END
$$;

-- The tickets received with the address behind a used export code, for the access
-- document. Each one stops when it was passed on: what came after is the next receiver's.
CREATE FUNCTION orders.received_export(p_code_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_email text;
BEGIN
  IF app.actor_role() IS DISTINCT FROM 'system' THEN
    RAISE EXCEPTION 'only the system exports receiver data' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT c.contact_email INTO v_email FROM orders.contact_codes c
   WHERE c.id = p_code_id AND c.purpose = 'export' AND c.used_at > now() - interval '5 minutes';
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'no export code was just used' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
             'event', jsonb_build_object('name', e.name, 'venueName', e.venue_name,
                                         'startsAt', e.starts_at),
             'typeName', tt.name,
             'claimedAt', x.claimed_at,
             'status', CASE WHEN ticketing.is_current_claim(x.id) THEN t.status
                            ELSE 'transferred' END) ORDER BY x.claimed_at)
      FROM ticketing.transfers x
      JOIN ticketing.tickets t ON t.id = x.ticket_id
      JOIN catalog.ticket_types tt ON tt.id = t.ticket_type_id
      JOIN events.events e ON e.id = t.event_id
     WHERE x.holder_email = v_email), '[]');
END
$$;

GRANT EXECUTE ON FUNCTION orders.recoverable_held(uuid) TO passripple_api;
GRANT EXECUTE ON FUNCTION orders.received_export(uuid) TO passripple_api;
