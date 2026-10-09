BEGIN;
SELECT plan(1);

SELECT has_schema('payments', 'module payments owns the payments schema');

SELECT * FROM finish(true);
ROLLBACK;





