-- Accounts (staff, organizers, inspectors and administrators), organizations and the
-- membership that lets an organizer act for an organization. Buyers have no account:
-- their contact lives on the order. No personal data is stored here yet.

CREATE TABLE identity.organizations (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text        NOT NULL CHECK (btrim(name) <> ''),
  -- Set by an administrator once the organizer is verified. Publishing requires it.
  verified_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE identity.users (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  is_admin    boolean     NOT NULL DEFAULT false,
  disabled_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE identity.memberships (
  org_id     uuid        NOT NULL REFERENCES identity.organizations (id),
  user_id    uuid        NOT NULL REFERENCES identity.users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  PRIMARY KEY (org_id, user_id)
);
CREATE INDEX memberships_user_idx ON identity.memberships (user_id);

-- ── Row Level Security ───────────────────────────────────────────────────────
ALTER TABLE identity.organizations ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
ALTER TABLE identity.users         ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
ALTER TABLE identity.memberships   ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;

-- Module roles: this module writes its tables, dependent modules read them.
CREATE POLICY organizations_module_read ON identity.organizations FOR SELECT USING (app.is_module_role());
CREATE POLICY organizations_module_write ON identity.organizations TO passripple_owner_identity
  USING (true) WITH CHECK (true);
CREATE POLICY users_module_read ON identity.users FOR SELECT USING (app.is_module_role());
CREATE POLICY users_module_write ON identity.users TO passripple_owner_identity
  USING (true) WITH CHECK (true);
CREATE POLICY memberships_module_read ON identity.memberships FOR SELECT USING (app.is_module_role());
CREATE POLICY memberships_module_write ON identity.memberships TO passripple_owner_identity
  USING (true) WITH CHECK (true);

-- The API: administrators see everything; an organizer sees the organization it acts for.
CREATE POLICY organizations_api_read ON identity.organizations FOR SELECT TO passripple_api
  USING ((SELECT app.actor_role()) = 'admin'
         OR ((SELECT app.actor_role()) = 'organizer' AND id = (SELECT app.org_id())));
CREATE POLICY organizations_api_insert ON identity.organizations FOR INSERT TO passripple_api
  WITH CHECK ((SELECT app.actor_role()) = 'admin');
CREATE POLICY organizations_api_update ON identity.organizations FOR UPDATE TO passripple_api
  USING ((SELECT app.actor_role()) = 'admin'
         OR ((SELECT app.actor_role()) = 'organizer' AND id = (SELECT app.org_id())))
  WITH CHECK ((SELECT app.actor_role()) = 'admin'
              OR ((SELECT app.actor_role()) = 'organizer' AND id = (SELECT app.org_id())));

-- A user sees their own account; administrators see and manage every account.
-- The system role creates accounts when someone signs up.
CREATE POLICY users_api_read ON identity.users FOR SELECT TO passripple_api
  USING ((SELECT app.actor_role()) = 'admin' OR id = (SELECT app.actor_id()));
CREATE POLICY users_api_insert ON identity.users FOR INSERT TO passripple_api
  WITH CHECK ((SELECT app.actor_role()) IN ('admin', 'system') AND NOT is_admin);
CREATE POLICY users_api_update ON identity.users FOR UPDATE TO passripple_api
  USING ((SELECT app.actor_role()) = 'admin') WITH CHECK ((SELECT app.actor_role()) = 'admin');

-- An organizer manages the members of the organization it acts for.
CREATE POLICY memberships_api_read ON identity.memberships FOR SELECT TO passripple_api
  USING ((SELECT app.actor_role()) = 'admin'
         OR ((SELECT app.actor_role()) = 'organizer' AND org_id = (SELECT app.org_id()))
         OR user_id = (SELECT app.actor_id()));
CREATE POLICY memberships_api_insert ON identity.memberships FOR INSERT TO passripple_api
  WITH CHECK ((SELECT app.actor_role()) = 'admin'
              OR ((SELECT app.actor_role()) = 'organizer' AND org_id = (SELECT app.org_id())));
CREATE POLICY memberships_api_update ON identity.memberships FOR UPDATE TO passripple_api
  USING ((SELECT app.actor_role()) = 'admin'
         OR ((SELECT app.actor_role()) = 'organizer' AND org_id = (SELECT app.org_id())))
  WITH CHECK ((SELECT app.actor_role()) = 'admin'
              OR ((SELECT app.actor_role()) = 'organizer' AND org_id = (SELECT app.org_id())));

GRANT USAGE ON SCHEMA identity TO passripple_api;
GRANT SELECT, INSERT (name), UPDATE (name) ON identity.organizations TO passripple_api;
GRANT SELECT, INSERT (id), UPDATE (is_admin, disabled_at) ON identity.users TO passripple_api;
GRANT SELECT, INSERT (org_id, user_id), UPDATE (revoked_at) ON identity.memberships TO passripple_api;

-- ── Session actor ────────────────────────────────────────────────────────────
-- The API calls this at the start of every transaction instead of setting app.* itself.
-- It checks that the actor may take the role, and for organizers that the user is an
-- active member of the organization, before setting the transaction-local settings.
CREATE FUNCTION identity.set_actor(p_actor_id uuid, p_actor_role text, p_org_id uuid DEFAULT NULL)
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

-- Only an administrator verifies an organization, and only through this function.
CREATE FUNCTION identity.set_organization_verified(p_org_id uuid, p_verified boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF app.actor_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'only an administrator verifies organizations' USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE identity.organizations
     SET verified_at = CASE WHEN p_verified THEN coalesce(verified_at, now()) END
   WHERE id = p_org_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'organization % not found', p_org_id USING ERRCODE = 'no_data_found';
  END IF;
END
$$;

GRANT EXECUTE ON FUNCTION identity.set_actor(uuid, text, uuid) TO passripple_api;
GRANT EXECUTE ON FUNCTION identity.set_organization_verified(uuid, boolean) TO passripple_api;
