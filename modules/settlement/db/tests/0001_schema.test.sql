BEGIN;
SELECT plan(1);

SELECT has_schema('settlement', 'module settlement owns the settlement schema');

SELECT * FROM finish(true);
ROLLBACK;
