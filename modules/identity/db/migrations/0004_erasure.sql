-- Account erasure (design 14.7): a signed-in person deletes their own account, from the gate
-- app or from the public /eliminar-datos page. identity erases what it holds: the email,
-- the codes sent to it, the sessions and the memberships. The account row stays, without
-- personal data and disabled, because scans and audit entries refer to its id. Other
-- modules erase their own data first (staff.release_user_devices), in the same
-- transaction.

CREATE FUNCTION identity.erase_user()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_user_id uuid := app.actor_id();
  v_email   text;
BEGIN
  IF v_user_id IS NULL OR app.actor_role() IN ('buyer', 'system') THEN
    RAISE EXCEPTION 'only a signed-in person erases their account' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT email INTO v_email FROM identity.users WHERE id = v_user_id FOR UPDATE;
  IF v_email IS NOT NULL THEN
    DELETE FROM identity.sign_in_codes WHERE email = v_email;
  END IF;
  UPDATE identity.user_sessions SET ended_at = coalesce(ended_at, now()) WHERE user_id = v_user_id;
  UPDATE identity.memberships SET revoked_at = coalesce(revoked_at, now()) WHERE user_id = v_user_id;
  UPDATE identity.users SET email = NULL, disabled_at = coalesce(disabled_at, now()) WHERE id = v_user_id;
END
$$;

GRANT EXECUTE ON FUNCTION identity.erase_user() TO passripple_api;
