BEGIN;
SELECT plan(1);

SELECT has_schema('events', 'module events owns the events schema');

SELECT * FROM finish(true);
ROLLBACK;





