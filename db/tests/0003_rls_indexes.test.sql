-- Design 9.2: a Row Level Security policy without an index turns every query into a full
-- scan. Every table with RLS enabled that has an event_id or org_id column must have an
-- index whose first column is that column (a primary key or unique constraint counts).
BEGIN;
SELECT plan(1);

SELECT is_empty(
  $$
  SELECT format('%I.%I(%I)', n.nspname, c.relname, a.attname)
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
   WHERE c.relkind IN ('r', 'p')
     AND c.relrowsecurity
     AND a.attname IN ('event_id', 'org_id')
     AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'app', 'migrations')
     AND NOT EXISTS (
       SELECT 1 FROM pg_index i
        WHERE i.indrelid = c.oid AND i.indkey[0] = a.attnum)
   ORDER BY 1
  $$,
  'every RLS table filtered by event_id or org_id has an index leading with it'
);

SELECT * FROM finish();
ROLLBACK;
