-- Enrollment of staff phones with a staff code (design 11.2). An organizer creates a code
-- tied to an event, a role, a zone and a time window, and shares it with the staff. A
-- signed-in person types it on their phone; the phone becomes a staff device of that event
-- and receives a device session token. Only hashes are stored: the code's keyed HMAC and
-- the token's SHA-256.
--
-- A revoked or expired device keeps a drain-only session for 30 days: it may still upload
-- what it scanned offline, because no recorded operation may be lost (I6), but it gets no
-- manifest. What it may do in each state is the API's decision, from the status returned
-- by staff.authenticate_device.

CREATE TABLE staff.staff_codes (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    uuid        NOT NULL REFERENCES events.events (id),
  -- HMAC-SHA256 of the canonical code, keyed with a Workers secret.
  code_hash   bytea       NOT NULL UNIQUE CHECK (length(code_hash) = 32),
  role        text        NOT NULL CHECK (role IN ('gate', 'door_sales', 'supervisor', 'inspector')),
  zone        text        CHECK (btrim(zone) <> ''),
  -- The window every device enrolled with this code gets.
  valid_from  timestamptz NOT NULL,
  valid_until timestamptz NOT NULL,
  max_uses    integer     NOT NULL CHECK (max_uses BETWEEN 1 AND 1000),
  uses        integer     NOT NULL DEFAULT 0 CHECK (uses >= 0 AND uses <= max_uses),
  created_by  uuid        NOT NULL REFERENCES identity.users (id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  revoked_at  timestamptz,
  CHECK (valid_until > valid_from)
);
CREATE INDEX staff_codes_event_idx ON staff.staff_codes (event_id);

ALTER TABLE staff.staff_devices
  ADD COLUMN platform      text CHECK (platform IN ('android', 'ios')),
  ADD COLUMN app_version   text CHECK (btrim(app_version) <> '' AND length(app_version) <= 32),
  ADD COLUMN staff_code_id uuid REFERENCES staff.staff_codes (id);

-- One session per enrolled device. The token is 32 random bytes kept in the phone's
-- Keychain or Keystore; only its SHA-256 is stored.
CREATE TABLE staff.device_sessions (
  token_hash bytea       PRIMARY KEY CHECK (length(token_hash) = 32),
  device_id  uuid        NOT NULL UNIQUE REFERENCES staff.staff_devices (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Set when the staff member signs the device out, with nothing left to upload.
  ended_at   timestamptz
);

-- ── Row Level Security ───────────────────────────────────────────────────────
ALTER TABLE staff.staff_codes ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
ALTER TABLE staff.device_sessions ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;

CREATE POLICY staff_codes_module_read ON staff.staff_codes FOR SELECT USING (app.is_module_role());
CREATE POLICY staff_codes_module_write ON staff.staff_codes TO passripple_owner_staff
  USING (true) WITH CHECK (true);
-- Organizers see their events' codes, never their hashes (left out of the column grant).
CREATE POLICY staff_codes_api_read ON staff.staff_codes FOR SELECT TO passripple_api
  USING ((SELECT app.actor_role()) = 'admin'
         OR EXISTS (SELECT 1 FROM events.events e
                     WHERE e.id = staff_codes.event_id
                       AND (SELECT app.actor_role()) = 'organizer' AND e.org_id = (SELECT app.org_id())));

CREATE POLICY device_sessions_module_read ON staff.device_sessions FOR SELECT USING (app.is_module_role());
CREATE POLICY device_sessions_module_write ON staff.device_sessions TO passripple_owner_staff
  USING (true) WITH CHECK (true);

GRANT SELECT (id, event_id, role, zone, valid_from, valid_until, max_uses, uses, created_by, created_at,
              revoked_at)
  ON staff.staff_codes TO passripple_api;

-- ── Functions ────────────────────────────────────────────────────────────────
-- Creates a staff code for an event of the organizer's organization and returns its id.
-- The Worker draws the code, shows it once and passes only its hash.
CREATE FUNCTION staff.create_code(
  p_event_id uuid, p_code_hash bytea, p_role text, p_zone text,
  p_valid_from timestamptz, p_valid_until timestamptz, p_max_uses integer
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_code_id uuid;
BEGIN
  IF NOT coalesce(app.actor_role() = 'organizer'
                  AND EXISTS (SELECT 1 FROM events.events e
                               WHERE e.id = p_event_id AND e.org_id = app.org_id()), false) THEN
    RAISE EXCEPTION 'event % is not available to this actor', p_event_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  INSERT INTO staff.staff_codes (event_id, code_hash, role, zone, valid_from, valid_until, max_uses, created_by)
  VALUES (p_event_id, p_code_hash, p_role, p_zone, p_valid_from, p_valid_until, p_max_uses, app.actor_id())
  RETURNING id INTO v_code_id;
  RETURN v_code_id;
END
$$;

-- Revokes a staff code: nobody else enrolls with it. Devices already enrolled keep working
-- until revoked one by one. Revoking twice keeps the first time.
CREATE FUNCTION staff.revoke_code(p_code_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_org_id uuid;
BEGIN
  SELECT e.org_id INTO v_org_id
    FROM staff.staff_codes c JOIN events.events e ON e.id = c.event_id
   WHERE c.id = p_code_id
     FOR UPDATE OF c;
  IF NOT FOUND
     OR NOT coalesce(app.actor_role() = 'admin'
                     OR (app.actor_role() = 'organizer' AND v_org_id = app.org_id()), false) THEN
    RAISE EXCEPTION 'staff code % is not available to this actor', p_code_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE staff.staff_codes SET revoked_at = coalesce(revoked_at, now()) WHERE id = p_code_id;
END
$$;

-- Enrolls the signed-in staff member's phone with a staff code and returns the new device.
-- Enrolling before the window opens is allowed: staff download the manifest at home, the
-- day before (8.2). An unknown, revoked, used-up or expired code gets the same error, so
-- the error says nothing about which codes exist. The integrity verdict is a signal, never
-- a block (11.2).
CREATE FUNCTION staff.enroll(
  p_code_hash bytea, p_token_hash bytea, p_platform text, p_app_version text, p_integrity text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_code      staff.staff_codes;
  v_device_id uuid;
BEGIN
  IF NOT coalesce(app.actor_role() = 'staff' AND app.actor_id() IS NOT NULL, false) THEN
    RAISE EXCEPTION 'only a signed-in staff member enrolls a device' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO v_code FROM staff.staff_codes WHERE code_hash = p_code_hash FOR UPDATE;
  IF NOT FOUND OR v_code.revoked_at IS NOT NULL OR v_code.valid_until <= now()
     OR v_code.uses >= v_code.max_uses THEN
    RAISE EXCEPTION 'staff code not valid' USING ERRCODE = 'no_data_found';
  END IF;
  UPDATE staff.staff_codes SET uses = uses + 1 WHERE id = v_code.id;
  INSERT INTO staff.staff_devices (event_id, user_id, role, zone, valid_from, valid_until, integrity,
                                   platform, app_version, staff_code_id)
  VALUES (v_code.event_id, app.actor_id(), v_code.role, v_code.zone, v_code.valid_from, v_code.valid_until,
          p_integrity, p_platform, p_app_version, v_code.id)
  RETURNING id INTO v_device_id;
  INSERT INTO staff.device_sessions (token_hash, device_id) VALUES (p_token_hash, v_device_id);
  RETURN v_device_id;
END
$$;

-- The device behind a session token, before any actor is set: it is how the API finds who
-- is acting. status is 'active' inside or before its window, 'revoked' once revoked (or its
-- user disabled), 'expired' after its window. A revoked or expired device authenticates for
-- 30 more days so it can drain its queue; after that, or once signed out, no row returns.
CREATE FUNCTION staff.authenticate_device(p_token_hash bytea)
RETURNS TABLE (device_id uuid, user_id uuid, event_id uuid, role text, zone text,
               valid_from timestamptz, valid_until timestamptz, revoked_at timestamptz, status text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT d.id, d.user_id, d.event_id, d.role, d.zone, d.valid_from, d.valid_until, d.revoked_at,
         CASE WHEN d.revoked_at IS NOT NULL OR u.disabled_at IS NOT NULL THEN 'revoked'
              WHEN d.valid_until <= now() THEN 'expired'
              ELSE 'active' END
    FROM staff.device_sessions s
    JOIN staff.staff_devices d ON d.id = s.device_id
    JOIN identity.users u ON u.id = d.user_id
   WHERE s.token_hash = p_token_hash
     AND s.ended_at IS NULL
     AND least(d.valid_until, coalesce(d.revoked_at, d.valid_until), coalesce(u.disabled_at, d.valid_until))
         > now() - interval '30 days'
$$;

-- Signs a device out, by its own staff member. The app allows it only with nothing left to
-- upload (8.9). The device is revoked as well, so its token is dead for good.
CREATE FUNCTION staff.sign_out_device(p_device_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF NOT coalesce(app.actor_role() = 'staff'
                  AND EXISTS (SELECT 1 FROM staff.staff_devices d
                               WHERE d.id = p_device_id AND d.user_id = app.actor_id()), false) THEN
    RAISE EXCEPTION 'device % is not available to this actor', p_device_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE staff.device_sessions SET ended_at = coalesce(ended_at, now()) WHERE device_id = p_device_id;
  UPDATE staff.staff_devices SET revoked_at = coalesce(revoked_at, now()) WHERE id = p_device_id;
END
$$;

GRANT EXECUTE ON FUNCTION staff.create_code(uuid, bytea, text, text, timestamptz, timestamptz, integer)
  TO passripple_api;
GRANT EXECUTE ON FUNCTION staff.revoke_code(uuid) TO passripple_api;
GRANT EXECUTE ON FUNCTION staff.enroll(bytea, bytea, text, text, text) TO passripple_api;
GRANT EXECUTE ON FUNCTION staff.authenticate_device(bytea) TO passripple_api;
GRANT EXECUTE ON FUNCTION staff.sign_out_device(uuid) TO passripple_api;
