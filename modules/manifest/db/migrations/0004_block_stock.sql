-- Door-sale stock in the gate manifest (design 8.5): a door-sales device gets the unsold
-- tickets of its own open blocks, so it can sell them without signal. Every other device
-- still sees only issued, bound and void tickets. Same signature as 0003.

CREATE OR REPLACE FUNCTION manifest.gate_tickets(p_device_id uuid, p_since xid8 DEFAULT NULL)
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
       -- Unsold tickets only reach the device whose block they are in (8.5).
       AND (t.status <> 'unsold'
            OR EXISTS (SELECT 1 FROM inventory.device_blocks b
                        WHERE b.id = t.block_id AND b.device_id = p_device_id
                          AND b.closed_at IS NULL))
       AND (v_device.zone IS NULL OR tt.zone IS NULL OR tt.zone = v_device.zone)
       AND (p_since IS NULL
            OR t.change_xid >= p_since
            OR a.change_xid >= p_since
            OR EXISTS (SELECT 1 FROM redemption.redemptions r
                        WHERE r.ticket_id = t.id AND r.change_xid >= p_since))
     ORDER BY t.id;
END
$$;
