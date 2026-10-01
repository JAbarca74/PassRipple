-- The session actor and Row Level Security as every module uses them. A probe table,
-- shaped like an organization-scoped module table and owned by a role that is not a
-- superuser, lives only inside this transaction.
BEGIN;
SELECT plan(33);

CREATE ROLE probe_owner NOLOGIN NOINHERIT;
CREATE SCHEMA probe AUTHORIZATION probe_owner;
GRANT USAGE ON SCHEMA probe TO passripple_api;

SET LOCAL ROLE probe_owner;
CREATE TABLE probe.items (id integer PRIMARY KEY, org_id uuid NOT NULL);
ALTER TABLE probe.items ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
CREATE POLICY items_by_org ON probe.items TO passripple_api
  USING (org_id = app.org_id()) WITH CHECK (org_id = app.org_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON probe.items TO passripple_api;

CREATE TABLE probe.ledger (id integer PRIMARY KEY);
CREATE TRIGGER ledger_append_only BEFORE UPDATE OR DELETE ON probe.ledger
  FOR EACH ROW EXECUTE FUNCTION app.reject_mutation();
CREATE TRIGGER ledger_no_truncate BEFORE TRUNCATE ON probe.ledger
  FOR EACH STATEMENT EXECUTE FUNCTION app.reject_mutation();
RESET ROLE;

-- Seeded as the superuser, the only role here that bypasses Row Level Security.
INSERT INTO probe.items VALUES
  (1, '00000000-0000-4000-8000-00000000000a'),
  (2, '00000000-0000-4000-8000-00000000000a'),
  (3, '00000000-0000-4000-8000-00000000000b');
INSERT INTO probe.ledger VALUES (1);

-- ── Session helpers ──────────────────────────────────────────────────────────
SELECT is(app.actor_id(), NULL, 'an unset actor reads as NULL');
SELECT is(app.actor_role(), NULL, 'an unset actor role reads as NULL');
SELECT is(app.org_id(), NULL, 'an unset organization reads as NULL');

SELECT set_config('app.actor_id', '00000000-0000-4000-8000-0000000000a1', true);
SELECT set_config('app.actor_role', 'organizer', true);
SELECT is(app.actor_id(), '00000000-0000-4000-8000-0000000000a1'::uuid, 'the actor set for the transaction is read back');
SELECT is(app.actor_role(), 'organizer', 'a known actor role is read back');

SELECT set_config('app.actor_role', 'root', true);
SELECT throws_ok('SELECT app.actor_role()', '22023', NULL, 'an unknown actor role is an error, not a silent default');
SELECT set_config('app.actor_role', 'Organizer', true);
SELECT throws_ok('SELECT app.actor_role()', '22023', NULL, 'actor roles are case-sensitive');
SELECT set_config('app.actor_id', 'not-a-uuid', true);
SELECT throws_ok('SELECT app.actor_id()', '22P02', NULL, 'a malformed actor id is an error');
SELECT set_config('app.org_id', '00000000-0000-4000-8000-00000000000a; DROP', true);
SELECT throws_ok('SELECT app.org_id()', '22P02', NULL, 'a malformed organization id is an error');

SELECT set_config('app.actor_id', '', true);
SELECT set_config('app.actor_role', '', true);
SELECT set_config('app.org_id', '', true);
SELECT is(app.org_id(), NULL, 'an emptied setting reads as NULL again');

-- ── Acting as the API ────────────────────────────────────────────────────────
-- SET SESSION AUTHORIZATION, not SET ROLE: SET ROLE is checked against the session user,
-- and the API logs in as passripple_api itself.
SET LOCAL SESSION AUTHORIZATION passripple_api;
SELECT set_config('app.org_id', '00000000-0000-4000-8000-00000000000a', true);

SELECT results_eq(
  'SELECT id FROM probe.items ORDER BY id', 'VALUES (1), (2)',
  'the API sees only the rows of the organization it acts for'
);
SELECT throws_ok(
  $$ INSERT INTO probe.items VALUES (4, '00000000-0000-4000-8000-00000000000b') $$, '42501', NULL,
  'the API cannot insert a row for another organization'
);
WITH changed AS (
  UPDATE probe.items SET id = id WHERE org_id = '00000000-0000-4000-8000-00000000000b' RETURNING 1
)
SELECT is(count(*)::integer, 0, 'the API cannot update rows of another organization') FROM changed;
WITH removed AS (
  DELETE FROM probe.items WHERE org_id = '00000000-0000-4000-8000-00000000000b' RETURNING 1
)
SELECT is(count(*)::integer, 0, 'the API cannot delete rows of another organization') FROM removed;
SELECT throws_ok(
  $$ UPDATE probe.items SET org_id = '00000000-0000-4000-8000-00000000000b' WHERE id = 1 $$, '42501', NULL,
  'the API cannot move its own row to another organization'
);
SELECT throws_ok('TRUNCATE probe.items', '42501', NULL, 'the API cannot truncate a table');

SELECT set_config('app.org_id', '00000000-0000-4000-8000-00000000000b', true);
SELECT results_eq('SELECT id FROM probe.items', 'VALUES (3)', 'another organization sees only its own rows');
SELECT set_config('app.org_id', '', true);
SELECT is((SELECT count(*)::integer FROM probe.items), 0, 'without an organization the API sees nothing');

-- Every way around Row Level Security that is open to a role without privileges.
SELECT set_config('row_security', 'off', true);
SELECT throws_ok(
  'SELECT count(*) FROM probe.items', '42501', NULL,
  'turning row_security off does not bypass it: the query fails instead'
);
SELECT set_config('row_security', 'on', true);
SELECT throws_ok(
  'ALTER TABLE probe.items DISABLE ROW LEVEL SECURITY', '42501', NULL,
  'the API cannot disable Row Level Security'
);
SELECT throws_ok(
  'ALTER TABLE probe.items NO FORCE ROW LEVEL SECURITY', '42501', NULL,
  'the API cannot stop forcing Row Level Security'
);
SELECT throws_ok('DROP POLICY items_by_org ON probe.items', '42501', NULL, 'the API cannot drop a policy');
SELECT throws_ok(
  $$ CREATE POLICY open_door ON probe.items TO passripple_api USING (true) $$, '42501', NULL,
  'the API cannot add a permissive policy'
);
SELECT throws_ok('SET ROLE probe_owner', '42501', NULL, 'the API cannot become the table owner');
SELECT throws_ok('SET ROLE passripple_owner_identity', '42501', NULL, 'the API cannot become a module role');
SELECT throws_ok(
  format('SET ROLE %I', (SELECT rolname FROM pg_roles WHERE oid = 10)), '42501', NULL,
  'the API cannot become the superuser'
);
SELECT throws_ok(
  'SET session_replication_role = replica', '42501', NULL,
  'the API cannot switch triggers off'
);
RESET SESSION AUTHORIZATION;

-- ── The owner is bound too ───────────────────────────────────────────────────
SET LOCAL ROLE probe_owner;
SELECT set_config('app.org_id', '00000000-0000-4000-8000-00000000000a', true);
SELECT is(
  (SELECT count(*)::integer FROM probe.items), 0,
  'with Row Level Security forced, even the table owner sees nothing without a policy for it'
);
RESET ROLE;

-- ── Append-only tables ───────────────────────────────────────────────────────
-- Run as the superuser: the trigger holds even for the most privileged role.
SELECT lives_ok('INSERT INTO probe.ledger VALUES (2)', 'an append-only table accepts inserts');
SELECT throws_ok('UPDATE probe.ledger SET id = 3 WHERE id = 1', '23001', NULL, 'an append-only table rejects UPDATE');
SELECT throws_ok('DELETE FROM probe.ledger WHERE id = 1', '23001', NULL, 'an append-only table rejects DELETE');
SELECT throws_ok('TRUNCATE probe.ledger', '23001', NULL, 'an append-only table rejects TRUNCATE');
SELECT results_eq('SELECT id FROM probe.ledger ORDER BY id', 'VALUES (1), (2)', 'the rejected changes left the rows untouched');

SELECT * FROM finish(true);
ROLLBACK;
