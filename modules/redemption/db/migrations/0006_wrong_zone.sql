-- Zone partition, enforced as a safety net (Phase 9, design 8.2). A device assigned to a zone
-- only has the tickets of that zone in its manifest, so a scan of another zone's ticket
-- cannot happen by construction. A modified app could still send one: the scan is recorded
-- (I6: nothing a device recorded is dropped) and reconciliation raises a 'wrong_zone'
-- incident, so the organizer sees which device admitted whom outside its zone.

ALTER TABLE redemption.incidents DROP CONSTRAINT incidents_kind_check;
ALTER TABLE redemption.incidents ADD CONSTRAINT incidents_kind_check CHECK (kind IN (
  -- reported by the device
  'operator', 'manual_entry_locked',
  -- raised by reconciliation
  'multi_device_redemption', 'out_of_manifest', 'after_revocation', 'wrong_zone'));

CREATE OR REPLACE FUNCTION redemption.apply_scan(
  p_device_id uuid, p_id uuid, p_device_seq bigint, p_scanned_at timestamptz, p_offset_ms integer,
  p_payload jsonb
) RETURNS text
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
  v_ticket_id  uuid := (p_payload->>'ticketId')::uuid;
  v_outcome    text;
  v_revoked_at timestamptz;
BEGIN
  IF v_ticket_id IS NULL THEN
    RAISE EXCEPTION 'a scan names its ticket' USING ERRCODE = 'not_null_violation';
  END IF;
  v_outcome := redemption.record_scan(p_id, v_ticket_id, p_device_id, p_device_seq, p_scanned_at,
                                      p_offset_ms, p_payload->>'method',
                                      coalesce((p_payload->>'idChecked')::boolean, false));

  -- The same single-use ticket admitted on another device (8.11).
  IF v_outcome = 'duplicate' AND EXISTS (
       SELECT 1 FROM redemption.redemptions r
        WHERE r.ticket_id = v_ticket_id AND r.outcome = 'admitted' AND r.device_id <> p_device_id) THEN
    PERFORM redemption.raise_incident('multi_device_redemption', p_device_id, v_ticket_id, p_id);
  END IF;
  -- The device verified the credential but did not find the ticket in its manifest (6.3).
  IF (p_payload->>'inManifest')::boolean IS FALSE THEN
    PERFORM redemption.raise_incident('out_of_manifest', p_device_id, v_ticket_id, p_id);
  END IF;
  -- A device of one zone admitted a ticket of a type that belongs to another zone (8.2).
  IF EXISTS (SELECT 1
               FROM staff.staff_devices d
               JOIN ticketing.tickets t ON t.id = v_ticket_id
               JOIN catalog.ticket_types tt ON tt.id = t.ticket_type_id
              WHERE d.id = p_device_id AND d.zone IS NOT NULL AND tt.zone IS NOT NULL
                AND tt.zone <> d.zone) THEN
    PERFORM redemption.raise_incident('wrong_zone', p_device_id, v_ticket_id, p_id);
  END IF;
  -- Recorded, by the device's corrected clock, after the device was revoked.
  SELECT d.revoked_at INTO v_revoked_at FROM staff.staff_devices d WHERE d.id = p_device_id;
  IF v_revoked_at IS NOT NULL
     AND p_scanned_at + make_interval(secs => coalesce(p_offset_ms, 0) / 1000.0) > v_revoked_at THEN
    PERFORM redemption.raise_incident('after_revocation', p_device_id, v_ticket_id, p_id);
  END IF;
  RETURN v_outcome;
END
$$;
