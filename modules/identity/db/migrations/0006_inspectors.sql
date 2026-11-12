-- Municipal accounts (Phase 8, design 12): the people of a canton who oversee events. An
-- "official" authorizes emissions and reads declarations; an "inspector" only verifies
-- tickets and reads the live count. An administrator grants and revokes them by email.
-- The canton code is plain text here: identity sits below jurisdictions, and the
-- municipal module checks it against the canton of each event.

CREATE TABLE identity.inspectors (
  user_id     uuid        NOT NULL REFERENCES identity.users (id),
  canton_code text        NOT NULL CHECK (canton_code ~ '^[0-9A-Za-z][0-9A-Za-z_-]*$' AND length(canton_code) <= 32),
  kind        text        NOT NULL CHECK (kind IN ('official', 'inspector')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  revoked_at  timestamptz,
  PRIMARY KEY (user_id, canton_code)
);

ALTER TABLE identity.inspectors ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
CREATE POLICY inspectors_module_read ON identity.inspectors FOR SELECT USING (app.is_module_role());
CREATE POLICY inspectors_module_write ON identity.inspectors TO passripple_owner_identity
  USING (true) WITH CHECK (true);
CREATE POLICY inspectors_admin_read ON identity.inspectors FOR SELECT TO passripple_api
  USING ((SELECT app.actor_role()) = 'admin');
GRANT SELECT ON identity.inspectors TO passripple_api;

-- An inspector acts only with an active grant: the role is the gate every municipal function
-- and the events functions build on.
CREATE OR REPLACE FUNCTION identity.set_actor(p_actor_id uuid, p_actor_role text, p_org_id uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF p_actor_role IS NULL
     OR p_actor_role NOT IN ('buyer', 'organizer', 'staff', 'inspector', 'admin', 'system') THEN
    RAISE EXCEPTION 'unknown actor role "%"', p_actor_role USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_actor_role IN ('buyer', 'system') THEN
    -- Buyers have no account, and the system acts for nobody in particular.
    IF p_actor_id IS NOT NULL OR p_org_id IS NOT NULL THEN
      RAISE EXCEPTION 'the % role acts without an account or organization', p_actor_role
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM identity.users u
                    WHERE u.id = p_actor_id AND u.disabled_at IS NULL) THEN
      RAISE EXCEPTION 'unknown or disabled user' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF p_actor_role = 'admin'
       AND NOT EXISTS (SELECT 1 FROM identity.users u WHERE u.id = p_actor_id AND u.is_admin) THEN
      RAISE EXCEPTION 'the user is not an administrator' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF p_actor_role = 'inspector'
       AND NOT EXISTS (SELECT 1 FROM identity.inspectors i
                        WHERE i.user_id = p_actor_id AND i.revoked_at IS NULL) THEN
      RAISE EXCEPTION 'the user has no municipal access' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF p_actor_role = 'organizer' THEN
      IF p_org_id IS NULL THEN
        RAISE EXCEPTION 'an organizer must act for an organization' USING ERRCODE = 'invalid_parameter_value';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM identity.memberships m
                      WHERE m.org_id = p_org_id AND m.user_id = p_actor_id AND m.revoked_at IS NULL) THEN
        RAISE EXCEPTION 'the user is not a member of this organization' USING ERRCODE = 'insufficient_privilege';
      END IF;
    ELSIF p_org_id IS NOT NULL THEN
      RAISE EXCEPTION 'only organizers act for an organization' USING ERRCODE = 'invalid_parameter_value';
    END IF;
  END IF;

  PERFORM set_config('app.actor_id', coalesce(p_actor_id::text, ''), true);
  PERFORM set_config('app.actor_role', p_actor_role, true);
  PERFORM set_config('app.org_id', coalesce(p_org_id::text, ''), true);
END
$$;

-- Grants municipal access to the person with this email, creating the account if it does
-- not exist yet so they can sign in with a code. Granting again after a revocation
-- reactivates the access.
CREATE FUNCTION identity.grant_inspector(p_email text, p_canton_code text, p_kind text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_email   text := lower(btrim(p_email));
  v_user_id uuid;
BEGIN
  IF app.actor_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'only an administrator grants municipal access' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_email IS NULL OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+$' OR length(v_email) > 254 THEN
    RAISE EXCEPTION 'invalid email' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT u.id INTO v_user_id FROM identity.users u WHERE u.email = v_email;
  IF v_user_id IS NULL THEN
    INSERT INTO identity.users (email) VALUES (v_email) RETURNING id INTO v_user_id;
  END IF;
  INSERT INTO identity.inspectors (user_id, canton_code, kind)
  VALUES (v_user_id, p_canton_code, p_kind)
  ON CONFLICT (user_id, canton_code) DO UPDATE SET kind = EXCLUDED.kind, revoked_at = NULL;
  RETURN v_user_id;
END
$$;

CREATE FUNCTION identity.revoke_inspector(p_user_id uuid, p_canton_code text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF app.actor_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'only an administrator revokes municipal access' USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE identity.inspectors SET revoked_at = coalesce(revoked_at, now())
   WHERE user_id = p_user_id AND canton_code = p_canton_code;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no municipal access for this user in %', p_canton_code USING ERRCODE = 'no_data_found';
  END IF;
END
$$;

GRANT EXECUTE ON FUNCTION identity.grant_inspector(text, text, text) TO passripple_api;
GRANT EXECUTE ON FUNCTION identity.revoke_inspector(uuid, text) TO passripple_api;

-- The panels also need to know whether the session holds municipal access.
DROP FUNCTION identity.session_profile(bytea);
CREATE FUNCTION identity.session_profile(p_token_hash bytea)
RETURNS TABLE (user_id uuid, is_admin boolean, organizations jsonb, municipal jsonb)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT u.id,
         u.is_admin,
         coalesce((
           SELECT jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name) ORDER BY o.name, o.id)
             FROM identity.memberships m
             JOIN identity.organizations o ON o.id = m.org_id
            WHERE m.user_id = u.id AND m.revoked_at IS NULL
         ), '[]'::jsonb),
         coalesce((
           SELECT jsonb_agg(jsonb_build_object('canton', i.canton_code, 'kind', i.kind)
                            ORDER BY i.canton_code)
             FROM identity.inspectors i
            WHERE i.user_id = u.id AND i.revoked_at IS NULL
         ), '[]'::jsonb)
    FROM identity.user_sessions s JOIN identity.users u ON u.id = s.user_id
   WHERE s.token_hash = p_token_hash
     AND s.ended_at IS NULL AND s.expires_at > now() AND u.disabled_at IS NULL
$$;

REVOKE ALL ON FUNCTION identity.session_profile(bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION identity.session_profile(bytea) TO passripple_api;
