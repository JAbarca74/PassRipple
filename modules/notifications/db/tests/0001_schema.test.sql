BEGIN;
SELECT plan(1);

SELECT has_schema('notifications', 'module notifications owns the notifications schema');

SELECT * FROM finish(true);
ROLLBACK;





