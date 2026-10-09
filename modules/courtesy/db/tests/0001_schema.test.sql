BEGIN;
SELECT plan(1);

SELECT has_schema('courtesy', 'module courtesy owns the courtesy schema');

SELECT * FROM finish(true);
ROLLBACK;





