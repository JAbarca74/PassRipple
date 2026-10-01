-- Rule R1 in the database: each module role writes only its own schema and reads only the
-- schemas of the modules it depends on, and the API role can never act as a table owner.
BEGIN;
SELECT plan(33);

-- ── The API role ─────────────────────────────────────────────────────────────
SELECT is_empty(
  $$ SELECT rolname FROM pg_roles WHERE rolname = 'passripple_api'
       AND (rolsuper OR rolbypassrls OR rolinherit OR rolcreaterole OR rolcreatedb OR rolreplication) $$,
  'the API role has no superuser, bypass, inherit, create-role, create-database or replication attribute'
);
SELECT is_empty(
  $$ SELECT roleid::regrole::text FROM pg_auth_members WHERE member = 'passripple_api'::regrole $$,
  'the API role is a member of no role, so it can never act as a table owner'
);
SELECT is_empty(
  $$ SELECT 'schema ' || nspname FROM pg_namespace WHERE nspowner = 'passripple_api'::regrole
     UNION ALL SELECT 'relation ' || oid::regclass FROM pg_class WHERE relowner = 'passripple_api'::regrole
     UNION ALL SELECT 'function ' || oid::regprocedure FROM pg_proc WHERE proowner = 'passripple_api'::regrole $$,
  'the API role owns nothing'
);
SELECT ok(
  NOT has_database_privilege('passripple_api', current_database(), 'CREATE'),
  'the API role cannot create schemas'
);
SELECT is_empty(
  $$ SELECT nspname FROM pg_namespace
      WHERE has_schema_privilege('passripple_api', oid, 'CREATE')
        AND nspname !~ '^pg_(toast_)?temp_' $$,
  'the API role cannot create objects in any schema'
);
SELECT ok(
  NOT has_schema_privilege('passripple_api', 'migrations', 'USAGE'),
  'the API role cannot see the migrations schema'
);
SELECT ok(
  NOT has_function_privilege('passripple_api', 'migrations.prepare_module(text,text,integer,text[])', 'EXECUTE')
  AND NOT has_function_privilege('passripple_api', 'migrations.allow_schema_creation(text,boolean)', 'EXECUTE'),
  'the API role cannot call the migration helpers'
);

-- ── Module roles ─────────────────────────────────────────────────────────────
SELECT ok((SELECT count(*) FROM migrations.modules) > 0, 'the migration runner recorded the modules');
SELECT is_empty(
  $$ SELECT m.name FROM migrations.modules m LEFT JOIN pg_roles r ON r.rolname = m.owner
      WHERE r.oid IS NULL OR r.rolsuper OR r.rolbypassrls OR r.rolcanlogin
         OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication $$,
  'every module has an owner role that cannot log in, bypass Row Level Security or create roles or databases'
);
SELECT is_empty(
  $$ SELECT m.name FROM migrations.modules m LEFT JOIN pg_namespace n ON n.nspname = m.schema
      WHERE n.oid IS NULL OR n.nspowner <> m.owner::regrole $$,
  'every module schema exists and belongs to its module role'
);
SELECT is_empty(
  $$ SELECT owner FROM migrations.modules WHERE has_database_privilege(owner, current_database(), 'CREATE') $$,
  'no module role can create schemas outside a migration'
);
SELECT is_empty(
  $$ SELECT m.owner || ' -> ' || n.nspname FROM migrations.modules m CROSS JOIN pg_namespace n
      WHERE n.nspname <> m.schema AND has_schema_privilege(m.owner, n.oid, 'CREATE')
        AND n.nspname !~ '^pg_(toast_)?temp_' $$,
  'a module role can create objects only in its own schema'
);
SELECT is_empty(
  $$ SELECT m.owner || ' -> ' || o.schema FROM migrations.modules m
       JOIN migrations.modules o ON o.schema <> m.schema
      WHERE has_schema_privilege(m.owner, o.schema, 'USAGE') <> (o.schema = ANY (m.depends_on)) $$,
  'a module role can read exactly the schemas of the modules it depends on'
);
SELECT is_empty(
  $$ SELECT 'relation ' || c.oid::regclass FROM pg_class c
       JOIN migrations.modules m ON m.schema = c.relnamespace::regnamespace::text
      WHERE c.relowner <> m.owner::regrole
     UNION ALL
     SELECT 'function ' || p.oid::regprocedure FROM pg_proc p
       JOIN migrations.modules m ON m.schema = p.pronamespace::regnamespace::text
      WHERE p.proowner <> m.owner::regrole
     UNION ALL
     SELECT 'type ' || t.oid::regtype FROM pg_type t
       JOIN migrations.modules m ON m.schema = t.typnamespace::regnamespace::text
      WHERE t.typowner <> m.owner::regrole $$,
  'everything in a module schema belongs to that module'
);

-- ── Where objects may live ───────────────────────────────────────────────────
SELECT is_empty(
  $$ SELECT nspname FROM pg_namespace
      WHERE nspname NOT IN (SELECT schema FROM migrations.modules)
        AND nspname NOT IN ('public', 'app', 'migrations', 'information_schema')
        AND nspname NOT LIKE 'pg\_%' $$,
  'every schema is a module schema or part of the database infrastructure'
);
SELECT is_empty(
  $$ SELECT c.oid::regclass::text FROM pg_class c
      WHERE c.relnamespace = 'public'::regnamespace
        AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
        AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_class'::regclass
                           AND d.objid = c.oid AND d.deptype = 'e')
     UNION ALL
     SELECT p.oid::regprocedure::text FROM pg_proc p
      WHERE p.pronamespace = 'public'::regnamespace
        AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass
                           AND d.objid = p.oid AND d.deptype = 'e') $$,
  'the public schema holds nothing but extensions'
);

-- ── Rules every module object must follow ────────────────────────────────────
SELECT is_empty(
  $$ SELECT c.oid::regclass::text FROM pg_class c
      WHERE c.relnamespace::regnamespace::text IN (SELECT schema FROM migrations.modules)
        AND c.relkind IN ('r', 'p')
        AND NOT (c.relrowsecurity AND c.relforcerowsecurity) $$,
  'every module table has Row Level Security enabled and forced'
);
SELECT is_empty(
  $$ SELECT c.oid::regclass::text FROM pg_class c
      WHERE c.relnamespace::regnamespace::text IN (SELECT schema FROM migrations.modules)
        AND c.relkind = 'v'
        AND NOT EXISTS (SELECT 1 FROM unnest(c.reloptions) o WHERE o ~ '^security_invoker=(true|on|1)$') $$,
  'every module view checks permissions as the caller, not as its owner'
);
SELECT is_empty(
  $$ SELECT p.oid::regprocedure::text FROM pg_proc p
      WHERE p.pronamespace::regnamespace::text IN (SELECT schema FROM migrations.modules)
        AND EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                     WHERE a.grantee = 0) $$,
  'no module function is executable by every role'
);
SELECT is_empty(
  $$ SELECT p.oid::regprocedure::text FROM pg_proc p
      WHERE p.pronamespace::regnamespace::text IN (SELECT schema FROM migrations.modules)
        AND p.prosecdef
        AND NOT EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search\_path=%') $$,
  'every SECURITY DEFINER function in a module pins its search_path'
);

-- ── Preparing a module keeps its access in sync with package.json ────────────
SELECT migrations.prepare_module('@passripple/inventory', 'inventory', 2, ARRAY['catalog', 'events', 'orders']);
SELECT ok(
  has_schema_privilege('passripple_owner_inventory', 'orders', 'USAGE'),
  'preparing a module grants read access to a newly declared dependency'
);
SELECT migrations.prepare_module('@passripple/inventory', 'inventory', 2, ARRAY['catalog', 'events']);
SELECT ok(
  NOT has_schema_privilege('passripple_owner_inventory', 'orders', 'USAGE'),
  'preparing a module again revokes access to a dependency it no longer declares'
);
SELECT throws_ok(
  $$ SELECT migrations.prepare_module('@passripple/inventory', 'inventory', 2, ARRAY['nowhere']) $$,
  'P0001', NULL,
  'a dependency on a schema that is not a prepared module is rejected'
);
SELECT throws_ok(
  $$ SELECT migrations.prepare_module('@passripple/inventory', 'inventory', 2, ARRAY['inventory']) $$,
  'P0001', NULL,
  'a module cannot list itself as a dependency'
);
SELECT throws_ok(
  $$ SELECT migrations.prepare_module('@passripple/evil', 'evil"; DROP SCHEMA app; --', 1, '{}') $$,
  'P0001', NULL,
  'a schema name that is not a plain identifier is rejected'
);
SELECT throws_ok(
  $$ SELECT migrations.allow_schema_creation('passripple_api', true) $$,
  'P0001', NULL,
  'only module roles can be allowed to create schemas'
);

-- ── A migration cannot escape its module ─────────────────────────────────────
-- What a migration of inventory (level 2, depends on events and catalog) runs into.
SET LOCAL ROLE passripple_owner_inventory;
SELECT lives_ok(
  'CREATE TABLE inventory.probe (id integer)',
  'a module role can create a table in its own schema'
);
SELECT throws_ok(
  'CREATE TABLE events.probe (id integer)', '42501', NULL,
  'a module role cannot create a table in a schema it depends on'
);
SELECT throws_ok(
  'CREATE TABLE orders.probe (id integer)', '42501', NULL,
  'a module role cannot even reference a schema it does not depend on'
);
SELECT throws_ok(
  'CREATE TABLE public.probe (id integer)', '42501', NULL,
  'a module role cannot create objects in public'
);
SELECT throws_ok(
  $$ CREATE FUNCTION app.probe() RETURNS integer LANGUAGE sql AS 'SELECT 1' $$, '42501', NULL,
  'a module role cannot add functions to the shared app schema'
);
SELECT throws_ok(
  'CREATE SCHEMA rogue', '42501', NULL,
  'a module role cannot create a new schema'
);
SELECT throws_ok(
  'SELECT * FROM migrations.applied', '42501', NULL,
  'a module role cannot read or rewrite the migration record'
);
RESET ROLE;
-- These privileges catch mistakes, not malice: the runner's session is a superuser, so a
-- migration could still RESET ROLE. Migrations are reviewed code.

SELECT * FROM finish(true);
ROLLBACK;
