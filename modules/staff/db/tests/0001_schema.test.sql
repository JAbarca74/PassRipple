BEGIN;
SELECT plan(1);

SELECT has_schema('staff', 'module staff owns the staff schema');

SELECT * FROM finish(true);
ROLLBACK;





