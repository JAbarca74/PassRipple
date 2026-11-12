-- Named tickets in the gate manifest (design 7.4, 8.3): whether the event is named, and for
-- each ticket its attendee's name and the document's last digits, never the number. A
-- delta also carries tickets whose attendee changed since the cursor.

DROP FUNCTION manifest.gate_event(uuid);
CREATE FUNCTION manifest.gate_event(p_device_id uuid)
RETURNS TABLE (event_id uuid, name text, venue_name text, starts_at timestamptz, ends_at timestamptz,
               age_rating text, device_zone text, named_tickets boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_device record;
BEGIN
  v_device := manifest.gate_device_event(p_device_id);
  RETURN QUERY
    SELECT e.id, e.name, e.venue_name, e.starts_at, e.ends_at, e.age_rating, v_device.zone,
           e.named_tickets
      FROM events.events e
     WHERE e.id = v_device.event_id;
END
$$;

DROP FUNCTION manifest.gate_tickets(uuid, xid8);
CREATE FUNCTION manifest.gate_tickets(p_device_id uuid, p_since xid8 DEFAULT NULL)
RETURNS TABLE (ticket_id uuid, type_ref integer, entry_mode text, status text, redeemed boolean,
               holder_pubkey bytea, key_version smallint, code_human text,
               attendee_name text, attendee_doc_last4 text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_device record;
BEGIN
  v_device := manifest.gate_device_event(p_device_id);
  RETURN QUERY
    SELECT t.id, tt.ref, t.entry_mode, t.status,
           EXISTS (SELECT 1 FROM redemption.redemptions r
                    WHERE r.ticket_id = t.id AND r.outcome = 'admitted' AND r.entry_mode = 'single_use'),
           t.holder_pubkey, t.key_version, t.code_human,
           a.full_name, a.doc_last4
      FROM ticketing.tickets t
      JOIN catalog.ticket_types tt ON tt.id = t.ticket_type_id
      LEFT JOIN ticketing.attendees a ON a.ticket_id = t.id
     WHERE t.event_id = v_device.event_id
       AND t.status <> 'unsold'
       AND (v_device.zone IS NULL OR tt.zone IS NULL OR tt.zone = v_device.zone)
       AND (p_since IS NULL
            OR t.change_xid >= p_since
            OR a.change_xid >= p_since
            OR EXISTS (SELECT 1 FROM redemption.redemptions r
                        WHERE r.ticket_id = t.id AND r.change_xid >= p_since))
     ORDER BY t.id;
END
$$;

GRANT EXECUTE ON FUNCTION manifest.gate_event(uuid) TO passripple_api;
GRANT EXECUTE ON FUNCTION manifest.gate_tickets(uuid, xid8) TO passripple_api;
