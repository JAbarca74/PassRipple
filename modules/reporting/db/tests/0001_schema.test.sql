BEGIN;
SELECT plan(1);

SELECT has_schema('reporting', 'module reporting owns the reporting schema');

SELECT * FROM finish(true);
ROLLBACK;
