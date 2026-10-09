BEGIN;
SELECT plan(1);

SELECT has_schema('privacy', 'module privacy owns the privacy schema');

SELECT * FROM finish(true);
ROLLBACK;





