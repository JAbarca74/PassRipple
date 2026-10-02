-- Account erasure, staff's part (design 14.7): the person's devices are revoked and their
-- sessions ended. Their scans stay, tied to the device and an account without personal data.
--
-- A phone may still hold scans it has not uploaded, and no recorded operation may be lost
-- (I6). So erasure waits while the person has a phone still enrolled and able to upload:
-- an open session whose device is inside its upload window (ADR 0018). Signing out from
-- the app, which the app allows only with an empty queue, ends that session; a lost phone
-- stops counting 30 days after its window or its revocation.

CREATE FUNCTION staff.release_user_devices()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_user_id uuid := app.actor_id();
  v_count   integer;
BEGIN
  IF v_user_id IS NULL OR app.actor_role() IN ('buyer', 'system') THEN
    RAISE EXCEPTION 'only a signed-in person releases their devices' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF EXISTS (SELECT 1 FROM staff.device_sessions s JOIN staff.staff_devices d ON d.id = s.device_id
              WHERE d.user_id = v_user_id
                AND s.ended_at IS NULL
                AND least(d.valid_until, coalesce(d.revoked_at, d.valid_until)) > now() - interval '30 days') THEN
    RAISE EXCEPTION 'a phone of this account is still enrolled and may hold scans to upload'
      USING ERRCODE = 'object_in_use';
  END IF;
  UPDATE staff.device_sessions SET ended_at = coalesce(ended_at, now())
   WHERE device_id IN (SELECT id FROM staff.staff_devices WHERE user_id = v_user_id);
  UPDATE staff.staff_devices SET revoked_at = coalesce(revoked_at, now()) WHERE user_id = v_user_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END
$$;

GRANT EXECUTE ON FUNCTION staff.release_user_devices() TO passripple_api;
