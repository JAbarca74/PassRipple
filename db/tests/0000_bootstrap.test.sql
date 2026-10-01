BEGIN;
SELECT plan(4);

SELECT has_table('migrations', 'applied', 'applied migrations are recorded');
SELECT has_role('passwave_api', 'the API role exists');
SELECT is(
  (SELECT rolbypassrls FROM pg_roles WHERE rolname = 'passwave_api'),
  false,
  'the API role cannot bypass Row Level Security'
);
SELECT ok(
  NOT has_schema_privilege('public', 'public', 'CREATE'),
  'nobody can create objects in the public schema'
);

SELECT * FROM finish(true);
ROLLBACK;
