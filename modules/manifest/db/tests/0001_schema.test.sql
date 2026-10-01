BEGIN;
SELECT plan(1);

SELECT has_schema('manifest', 'module manifest owns the manifest schema');

SELECT * FROM finish(true);
ROLLBACK;
