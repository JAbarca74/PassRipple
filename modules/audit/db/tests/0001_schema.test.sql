BEGIN;
SELECT plan(1);

SELECT has_schema('audit', 'module audit owns the audit schema');

SELECT * FROM finish(true);
ROLLBACK;
