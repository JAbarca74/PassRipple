BEGIN;
SELECT plan(1);

SELECT has_schema('seo', 'module seo owns the seo schema');

SELECT * FROM finish(true);
ROLLBACK;





