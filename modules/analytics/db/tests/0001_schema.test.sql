BEGIN;
SELECT plan(1);

SELECT has_schema('analytics', 'module analytics owns the analytics schema');

SELECT * FROM finish(true);
ROLLBACK;





