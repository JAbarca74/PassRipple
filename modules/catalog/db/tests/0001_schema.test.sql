BEGIN;
SELECT plan(1);

SELECT has_schema('catalog', 'module catalog owns the catalog schema');

SELECT * FROM finish(true);
ROLLBACK;





