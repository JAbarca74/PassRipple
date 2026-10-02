-- Runs before every migration. Every statement must be idempotent.

-- Nobody creates objects in the public schema: each module owns its own schema.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

-- Record of applied migrations. Migrations are immutable once applied.
CREATE SCHEMA IF NOT EXISTS migrations;
CREATE TABLE IF NOT EXISTS migrations.applied (
  module     text        NOT NULL,
  file       text        NOT NULL,
  checksum   text        NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (module, file)
);

-- Role used by the API. It can never bypass Row Level Security, it inherits nothing,
-- and it is never made a member of a module role: a module role owns tables, and a
-- table owner can switch Row Level Security off.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'passripple_api') THEN
    CREATE ROLE passripple_api NOLOGIN NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;
ALTER ROLE passripple_api NOINHERIT NOBYPASSRLS;

-- ── Module roles (rule R1) ───────────────────────────────────────────────────
-- Each module has an owner role, passripple_owner_<schema>, that owns its schema and
-- everything in it. Migrations run as that role, so a migration that writes to another
-- schema, or reads a schema its module does not depend on, fails when it is applied.

-- One row per module, written by the migration runner from each package.json.
CREATE TABLE IF NOT EXISTS migrations.modules (
  name       text    PRIMARY KEY,
  schema     text    NOT NULL UNIQUE CHECK (schema ~ '^[a-z][a-z0-9_]*$'),
  owner      text    NOT NULL UNIQUE,
  level      integer NOT NULL CHECK (level BETWEEN 1 AND 4),
  depends_on text[]  NOT NULL DEFAULT '{}'
);

-- Creates or updates a module's owner role and schema, and grants it read access to the
-- schemas of the modules it depends on, and nothing else. Every dependency must already
-- be prepared: the runner calls this in dependency order. Returns the owner role.
CREATE OR REPLACE FUNCTION migrations.prepare_module(
  p_name text, p_schema text, p_level integer, p_depends_on text[]
) RETURNS text
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
  v_owner   text := 'passripple_owner_' || p_schema;
  v_missing text;
  v_schema  text;
BEGIN
  IF p_schema !~ '^[a-z][a-z0-9_]*$' THEN
    RAISE EXCEPTION 'invalid schema name for module %: "%"', p_name, p_schema;
  END IF;

  SELECT d INTO v_missing
    FROM unnest(p_depends_on) AS d
   WHERE d = p_schema OR d NOT IN (SELECT schema FROM migrations.modules)
   LIMIT 1;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'module % depends on schema "%", which is not a prepared module', p_name, v_missing;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_owner) THEN
    EXECUTE format('CREATE ROLE %I NOLOGIN NOINHERIT NOBYPASSRLS', v_owner);
  END IF;
  EXECUTE format('ALTER ROLE %I NOLOGIN NOINHERIT NOBYPASSRLS', v_owner);
  -- On a managed service such as Neon the migration role is not a superuser. Since
  -- PostgreSQL 16 creating a role does not let its creator act as it, so the migration
  -- role becomes a member: SET to create the schema for it and run migrations as it,
  -- INHERIT to grant and revoke on the objects it owns. The API role never gets this.
  EXECUTE format('GRANT %I TO CURRENT_USER WITH INHERIT TRUE, SET TRUE', v_owner);

  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = p_schema) THEN
    EXECUTE format('CREATE SCHEMA %I AUTHORIZATION %I', p_schema, v_owner);
  ELSE
    EXECUTE format('ALTER SCHEMA %I OWNER TO %I', p_schema, v_owner);
  END IF;

  -- Functions are executable by PUBLIC by default. A module decides who calls each one.
  EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC', v_owner);

  INSERT INTO migrations.modules (name, schema, owner, level, depends_on)
  VALUES (p_name, p_schema, v_owner, p_level, p_depends_on)
  ON CONFLICT (name) DO UPDATE
    SET schema = excluded.schema, owner = excluded.owner,
        level = excluded.level, depends_on = excluded.depends_on;

  -- Read access to dependencies, revoked from every other module schema. Revoking also
  -- covers a dependency removed from package.json since the last run.
  FOR v_schema IN SELECT schema FROM migrations.modules WHERE schema <> p_schema LOOP
    IF v_schema = ANY (p_depends_on) THEN
      EXECUTE format('GRANT USAGE ON SCHEMA %I TO %I', v_schema, v_owner);
      EXECUTE format('GRANT SELECT, REFERENCES ON ALL TABLES IN SCHEMA %I TO %I', v_schema, v_owner);
      EXECUTE format('GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA %I TO %I', v_schema, v_owner);
    ELSE
      EXECUTE format('REVOKE ALL ON SCHEMA %I FROM %I', v_schema, v_owner);
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA %I FROM %I', v_schema, v_owner);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA %I FROM %I', v_schema, v_owner);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA %I FROM %I', v_schema, v_owner);
    END IF;
  END LOOP;

  RETURN v_owner;
END
$$;

-- A module's first migration runs CREATE SCHEMA IF NOT EXISTS, which needs the CREATE
-- privilege on the database even when the schema exists. The runner grants it inside the
-- migration's transaction and revokes it before committing.
CREATE OR REPLACE FUNCTION migrations.allow_schema_creation(p_owner text, p_allow boolean)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF p_owner NOT IN (SELECT owner FROM migrations.modules) THEN
    RAISE EXCEPTION '% is not a module owner role', p_owner;
  END IF;
  IF p_allow THEN
    EXECUTE format('GRANT CREATE ON DATABASE %I TO %I', current_database(), p_owner);
  ELSE
    EXECUTE format('REVOKE CREATE ON DATABASE %I FROM %I', current_database(), p_owner);
  END IF;
END
$$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA migrations FROM PUBLIC;

-- ── Session actor and shared helpers ─────────────────────────────────────────
-- Infrastructure shared by every module, like the migrations schema: functions only,
-- no data. The API sets three transaction-local settings at the start of every
-- transaction, and Row Level Security policies read them through these functions:
--
--   app.actor_id    uuid of the signed-in user (absent for buyers, who have no account)
--   app.actor_role  buyer | organizer | staff | inspector | admin | system
--   app.org_id      organization the request acts for (organizers only)
--
-- An unset value reads as NULL, so a policy comparing against it matches nothing.
-- A malformed value raises an error instead of being ignored.
CREATE SCHEMA IF NOT EXISTS app;
COMMENT ON SCHEMA app IS 'Session helpers shared by every module. Holds no data.';
REVOKE ALL ON SCHEMA app FROM PUBLIC;
GRANT USAGE ON SCHEMA app TO PUBLIC;

CREATE OR REPLACE FUNCTION app.actor_id() RETURNS uuid
LANGUAGE sql STABLE PARALLEL SAFE
AS $$ SELECT nullif(pg_catalog.current_setting('app.actor_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION app.org_id() RETURNS uuid
LANGUAGE sql STABLE PARALLEL SAFE
AS $$ SELECT nullif(pg_catalog.current_setting('app.org_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION app.actor_role() RETURNS text
LANGUAGE plpgsql STABLE PARALLEL SAFE
SET search_path = pg_catalog
AS $$
DECLARE
  v_role text := nullif(current_setting('app.actor_role', true), '');
BEGIN
  IF v_role IS NOT NULL
     AND v_role NOT IN ('buyer', 'organizer', 'staff', 'inspector', 'admin', 'system') THEN
    RAISE EXCEPTION 'unknown actor role "%"', v_role USING ERRCODE = 'invalid_parameter_value';
  END IF;
  RETURN v_role;
END
$$;

-- True when the query runs as a module role: inside a module's SECURITY DEFINER function,
-- or a migration. Policies use it to let module roles read every row of the tables they
-- were granted (their own and their dependencies'), while the API stays filtered by the
-- session actor. Which tables a module role may read is decided by its grants.
CREATE OR REPLACE FUNCTION app.is_module_role() RETURNS boolean
LANGUAGE sql STABLE PARALLEL SAFE
AS $$ SELECT pg_catalog.starts_with(current_user::text, 'passripple_owner_') $$;

-- Trigger for append-only tables (ledger, consents, redemptions): attach it to
-- BEFORE UPDATE OR DELETE (FOR EACH ROW) and BEFORE TRUNCATE (FOR EACH STATEMENT).
CREATE OR REPLACE FUNCTION app.reject_mutation() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION '%.% is append-only: % is not allowed', TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END
$$;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO PUBLIC;
