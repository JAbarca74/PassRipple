BEGIN;
SELECT plan(1);

SELECT has_schema('invoicing', 'module invoicing owns the invoicing schema');

SELECT * FROM finish(true);
ROLLBACK;
