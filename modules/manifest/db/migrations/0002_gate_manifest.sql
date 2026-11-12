-- The secret-free package a gate device downloads before an event (design 8.3), read from
-- the modules that own each part: the event and its window (events), ticket types
-- (catalog), tickets and their device keys (ticketing) and whether a single-use ticket was
-- admitted (redemption). Nothing here is a secret: public keys, identifiers, states and the
-- fallback codes (ADR 0015 accepts that whoever extracts a manifest knows them).
--
-- Only an active device of the acting staff member gets its event's manifest; revoked and
-- expired devices only upload (ADR 0018). A device assigned to a zone gets the tickets of
-- that zone and of types without a zone.
--
-- Incremental updates: manifest.cursor() is taken before the tickets are read, and the
-- device passes it back as `since`. A ticket is sent again when it changed, or a scan of it
-- was recorded, by a transaction at or after that cursor (ticketing 0004, redemption 0003).
-- A ticket may come twice; each row replaces the device's copy whole.

-- The event of an active device of the acting staff member, and its zone. Raises otherwise.
CREATE FUNCTION manifest.gate_device_event(p_device_id uuid, OUT event_id uuid, OUT zone text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  SELECT d.event_id, d.zone INTO event_id, zone
    FROM staff.staff_devices d
   WHERE d.id = p_device_id
     AND d.user_id = app.actor_id()
     AND app.actor_role() = 'staff'
     AND d.revoked_at IS NULL
     AND d.valid_until > now();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'device % has no manifest for this actor', p_device_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;
END
$$;

-- The oldest transaction still running: the cursor for the next incremental update.
CREATE FUNCTION manifest.cursor()
RETURNS xid8
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT pg_snapshot_xmin(pg_current_snapshot())
$$;

CREATE FUNCTION manifest.gate_event(p_device_id uuid)
RETURNS TABLE (event_id uuid, name text, venue_name text, starts_at timestamptz, ends_at timestamptz,
               age_rating text, device_zone text)
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
    SELECT e.id, e.name, e.venue_name, e.starts_at, e.ends_at, e.age_rating, v_device.zone
      FROM events.events e
     WHERE e.id = v_device.event_id;
END
$$;

CREATE FUNCTION manifest.gate_ticket_types(p_device_id uuid)
RETURNS TABLE (ref integer, name text, zone text, entry_mode text, audience text)
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
    SELECT tt.ref, tt.name, tt.zone, tt.entry_mode, tt.audience
      FROM catalog.ticket_types tt
     WHERE tt.event_id = v_device.event_id
       AND (v_device.zone IS NULL OR tt.zone IS NULL OR tt.zone = v_device.zone)
     ORDER BY tt.ref;
END
$$;

-- The event's tickets for a device, all of them or those changed at or after p_since.
-- Unsold door-sale tickets are left out: nobody holds them yet.
CREATE FUNCTION manifest.gate_tickets(p_device_id uuid, p_since xid8 DEFAULT NULL)
RETURNS TABLE (ticket_id uuid, type_ref integer, entry_mode text, status text, redeemed boolean,
               holder_pubkey bytea, key_version smallint, code_human text)
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
           t.holder_pubkey, t.key_version, t.code_human
      FROM ticketing.tickets t
      JOIN catalog.ticket_types tt ON tt.id = t.ticket_type_id
     WHERE t.event_id = v_device.event_id
       AND t.status <> 'unsold'
       AND (v_device.zone IS NULL OR tt.zone IS NULL OR tt.zone = v_device.zone)
       AND (p_since IS NULL
            OR t.change_xid >= p_since
            OR EXISTS (SELECT 1 FROM redemption.redemptions r
                        WHERE r.ticket_id = t.id AND r.change_xid >= p_since))
     ORDER BY t.id;
END
$$;

GRANT USAGE ON SCHEMA manifest TO passripple_api;
GRANT EXECUTE ON FUNCTION manifest.cursor() TO passripple_api;
GRANT EXECUTE ON FUNCTION manifest.gate_event(uuid) TO passripple_api;
GRANT EXECUTE ON FUNCTION manifest.gate_ticket_types(uuid) TO passripple_api;
GRANT EXECUTE ON FUNCTION manifest.gate_tickets(uuid, xid8) TO passripple_api;
