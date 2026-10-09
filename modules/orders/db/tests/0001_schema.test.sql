BEGIN;
SELECT plan(1);

SELECT has_schema('orders', 'module orders owns the orders schema');

SELECT * FROM finish(true);
ROLLBACK;





