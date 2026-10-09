BEGIN;
SELECT plan(1);

SELECT has_schema('redemption', 'module redemption owns the redemption schema');

SELECT * FROM finish(true);
ROLLBACK;





