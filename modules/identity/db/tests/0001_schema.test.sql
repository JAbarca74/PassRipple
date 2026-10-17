BEGIN;
SELECT plan(1);

SELECT has_schema('identity', 'module identity owns the identity schema');

SELECT * FROM finish(true);
ROLLBACK;
