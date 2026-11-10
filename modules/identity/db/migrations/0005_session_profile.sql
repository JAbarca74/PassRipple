-- Who a session belongs to, for the panels of the app (Phase 4): whether the person is a
-- platform administrator and which organizations they act for. The token hash is the
-- credential, as in identity.authenticate_session; an ended, expired or disabled session
-- returns no row. Revoked memberships are left out.

CREATE FUNCTION identity.session_profile(p_token_hash bytea)
RETURNS TABLE (user_id uuid, is_admin boolean, organizations jsonb)
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
         ), '[]'::jsonb)
    FROM identity.user_sessions s JOIN identity.users u ON u.id = s.user_id
   WHERE s.token_hash = p_token_hash
     AND s.ended_at IS NULL AND s.expires_at > now() AND u.disabled_at IS NULL
$$;

REVOKE ALL ON FUNCTION identity.session_profile(bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION identity.session_profile(bytea) TO passripple_api;
