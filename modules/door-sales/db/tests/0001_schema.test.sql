BEGIN;
SELECT plan(1);

SELECT has_schema('door_sales', 'module door-sales owns the door_sales schema');

SELECT * FROM finish(true);
ROLLBACK;
