-- Staff devices: who may validate or sell at an event, in which role and zone, and for
-- how long. Enrollment with a staff code arrives in Phase 2; this first version lets an
-- organizer register and revoke devices. This module never validates tickets.

CREATE TABLE staff.staff_devices (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    uuid        NOT NULL REFERENCES events.events (id),
  user_id     uuid        NOT NULL REFERENCES identity.users (id),
  role        text        NOT NULL CHECK (role IN ('gate', 'door_sales', 'supervisor', 'inspector')),
  -- Zone partition, when the event uses one.
  zone        text        CHECK (btrim(zone) <> ''),
  valid_from  timestamptz NOT NULL,
  valid_until timestamptz NOT NULL,
  revoked_at  timestamptz,
  -- Play Integrity or App Attest verdict: a signal, never a block.
  integrity   text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_until > valid_from)
);
CREATE INDEX staff_devices_event_idx ON staff.staff_devices (event_id);
CREATE INDEX staff_devices_user_idx ON staff.staff_devices (user_id);

-- ── Row Level Security ───────────────────────────────────────────────────────
ALTER TABLE staff.staff_devices ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;

CREATE POLICY staff_devices_module_read ON staff.staff_devices FOR SELECT USING (app.is_module_role());
CREATE POLICY staff_devices_module_write ON staff.staff_devices TO passripple_owner_staff
  USING (true) WITH CHECK (true);
-- Organizers see their events' devices; a staff member sees their own.
CREATE POLICY staff_devices_api_read ON staff.staff_devices FOR SELECT TO passripple_api
  USING ((SELECT app.actor_role()) = 'admin'
         OR user_id = (SELECT app.actor_id())
         OR EXISTS (SELECT 1 FROM events.events e
                     WHERE e.id = staff_devices.event_id
                       AND (SELECT app.actor_role()) = 'organizer' AND e.org_id = (SELECT app.org_id())));

GRANT USAGE ON SCHEMA staff TO passripple_api;
GRANT SELECT ON staff.staff_devices TO passripple_api;

-- ── Functions ────────────────────────────────────────────────────────────────
CREATE FUNCTION staff.register_device(
  p_event_id uuid, p_user_id uuid, p_role text, p_zone text,
  p_valid_from timestamptz, p_valid_until timestamptz
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_device_id uuid;
BEGIN
  IF NOT coalesce(app.actor_role() = 'organizer'
                  AND EXISTS (SELECT 1 FROM events.events e
                               WHERE e.id = p_event_id AND e.org_id = app.org_id()), false) THEN
    RAISE EXCEPTION 'event % is not available to this actor', p_event_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  INSERT INTO staff.staff_devices (event_id, user_id, role, zone, valid_from, valid_until)
  VALUES (p_event_id, p_user_id, p_role, p_zone, p_valid_from, p_valid_until)
  RETURNING id INTO v_device_id;
  RETURN v_device_id;
END
$$;

-- Revokes a device. Revoking twice keeps the first revocation time.
CREATE FUNCTION staff.revoke_device(p_device_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_org_id uuid;
BEGIN
  SELECT e.org_id INTO v_org_id
    FROM staff.staff_devices d JOIN events.events e ON e.id = d.event_id
   WHERE d.id = p_device_id
     FOR UPDATE OF d;
  IF NOT FOUND
     OR NOT coalesce(app.actor_role() = 'admin'
                     OR (app.actor_role() = 'organizer' AND v_org_id = app.org_id()), false) THEN
    RAISE EXCEPTION 'device % is not available to this actor', p_device_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE staff.staff_devices SET revoked_at = coalesce(revoked_at, now()) WHERE id = p_device_id;
END
$$;

GRANT EXECUTE ON FUNCTION staff.register_device(uuid, uuid, text, text, timestamptz, timestamptz)
  TO passripple_api;
GRANT EXECUTE ON FUNCTION staff.revoke_device(uuid) TO passripple_api;
