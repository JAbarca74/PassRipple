BEGIN;
SELECT plan(1);

SELECT has_schema('inventory', 'module inventory owns the inventory schema');

SELECT * FROM finish(true);
ROLLBACK;
