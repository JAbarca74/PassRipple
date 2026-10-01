BEGIN;
SELECT plan(1);

SELECT has_schema('municipal', 'module municipal owns the municipal schema');

SELECT * FROM finish(true);
ROLLBACK;
