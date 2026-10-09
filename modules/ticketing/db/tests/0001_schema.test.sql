BEGIN;
SELECT plan(1);

SELECT has_schema('ticketing', 'module ticketing owns the ticketing schema');

SELECT * FROM finish(true);
ROLLBACK;





