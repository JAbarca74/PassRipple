BEGIN;
SELECT plan(1);

SELECT has_schema('jurisdictions', 'module jurisdictions owns the jurisdictions schema');

SELECT * FROM finish(true);
ROLLBACK;
