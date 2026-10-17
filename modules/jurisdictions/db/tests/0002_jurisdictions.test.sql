BEGIN;
SELECT plan(15);

-- ── Superuser setup ──────────────────────────────────────────────────────────
INSERT INTO identity.users (id, is_admin) VALUES
  ('00000000-0000-4000-8000-00000000000a', true),
  ('00000000-0000-4000-8000-00000000000b', false);

INSERT INTO jurisdictions.jurisdictions (canton_code, name, tax_rate_bps, courtesy_deduct_bps, settlement_rule, guarantee_bps)
VALUES ('TEST-01', 'Test Canton', 500, '{}', 'next_business_day', NULL);

-- ── API actions ──────────────────────────────────────────────────────────────
SET LOCAL SESSION AUTHORIZATION passripple_api;

SELECT identity.set_actor('00000000-0000-4000-8000-00000000000a', 'admin');

SELECT throws_ok(
  $$ INSERT INTO jurisdictions.jurisdictions (canton_code, name, tax_rate_bps, courtesy_deduct_bps, settlement_rule) VALUES ('TEST-02', 'Test', -1, '{}', 'next_business_day') $$,
  '23514', NULL, 'bps cannot be negative'
);
SELECT throws_ok(
  $$ INSERT INTO jurisdictions.jurisdictions (canton_code, name, tax_rate_bps, courtesy_deduct_bps, settlement_rule) VALUES ('TEST-02', 'Test', 10001, '{}', 'next_business_day') $$,
  '23514', NULL, 'bps cannot exceed 10000'
);

SELECT throws_ok(
  $$ INSERT INTO jurisdictions.jurisdictions (canton_code, name, tax_rate_bps, courtesy_deduct_bps, settlement_rule) VALUES ('TEST-02', 'Test', 500, '[]', 'next_business_day') $$,
  '23514', NULL, 'courtesy_deduct_bps must be an object'
);
SELECT throws_ok(
  $$ INSERT INTO jurisdictions.jurisdictions (canton_code, name, tax_rate_bps, courtesy_deduct_bps, settlement_rule) VALUES ('TEST-02', 'Test', 500, '{"a": -1}', 'next_business_day') $$,
  '23514', NULL, 'courtesy_deduct_bps values cannot be negative'
);
SELECT throws_ok(
  $$ INSERT INTO jurisdictions.jurisdictions (canton_code, name, tax_rate_bps, courtesy_deduct_bps, settlement_rule) VALUES ('TEST-02', 'Test', 500, '{"a": 10001}', 'next_business_day') $$,
  '23514', NULL, 'courtesy_deduct_bps values cannot exceed 10000'
);
SELECT throws_ok(
  $$ INSERT INTO jurisdictions.jurisdictions (canton_code, name, tax_rate_bps, courtesy_deduct_bps, settlement_rule) VALUES ('TEST-02', 'Test', 500, '{"a": "500"}', 'next_business_day') $$,
  '23514', NULL, 'courtesy_deduct_bps values must be numbers'
);

SELECT throws_ok(
  $$ INSERT INTO jurisdictions.jurisdictions (canton_code, name, tax_rate_bps, courtesy_deduct_bps, settlement_rule) VALUES ('Invalid Code!', 'Test', 500, '{}', 'next_business_day') $$,
  '23514', NULL, 'canton_code must be valid'
);
SELECT throws_ok(
  $$ INSERT INTO jurisdictions.jurisdictions (canton_code, name, tax_rate_bps, courtesy_deduct_bps, settlement_rule) VALUES ('TEST-02', '   ', 500, '{}', 'next_business_day') $$,
  '23514', NULL, 'name cannot be empty or just spaces'
);

SELECT throws_ok(
  $$ UPDATE jurisdictions.jurisdictions SET canton_code = 'TEST-02' WHERE canton_code = 'TEST-01' $$,
  '42501', NULL, 'the API cannot change the canton_code'
);
SELECT throws_ok(
  $$ DELETE FROM jurisdictions.jurisdictions WHERE canton_code = 'TEST-01' $$,
  '42501', NULL, 'the API cannot DELETE a canton'
);
SELECT throws_ok(
  $$ TRUNCATE jurisdictions.jurisdictions $$,
  '42501', NULL, 'the API cannot TRUNCATE the table'
);

-- Write without being admin
SELECT identity.set_actor(NULL, 'system', NULL);

SELECT set_config('app.actor_role', 'organizer', true); -- Bypassing identity.set_actor for this test just to ensure RLS blocks it
SELECT throws_ok(
  $$ INSERT INTO jurisdictions.jurisdictions (canton_code, name, tax_rate_bps, courtesy_deduct_bps, settlement_rule) VALUES ('TEST-02', 'Test', 500, '{}', 'next_business_day') $$,
  '42501', NULL, 'only an admin can insert a canton'
);
WITH updated AS (UPDATE jurisdictions.jurisdictions SET name = 'New Name' WHERE canton_code = 'TEST-01' RETURNING 1)
SELECT is((SELECT count(*)::int FROM updated), 0, 'only an admin can update a canton');

-- Proper non-admin via set_actor
SELECT identity.set_actor(NULL, 'system', NULL);
SELECT throws_ok(
  $$ INSERT INTO jurisdictions.jurisdictions (canton_code, name, tax_rate_bps, courtesy_deduct_bps, settlement_rule) VALUES ('TEST-02', 'Test', 500, '{}', 'next_business_day') $$,
  '42501', NULL, 'only an admin can insert a canton (system)'
);

RESET SESSION AUTHORIZATION;

-- ── Validate data integrity as superuser ─────────────────────────────────────
-- TRUNCATE by superuser is possible, but let's test a constraint explicitly
SELECT throws_ok(
  $$ UPDATE jurisdictions.jurisdictions SET tax_rate_bps = 10001 WHERE canton_code = 'TEST-01' $$,
  '23514', NULL, 'superuser cannot violate constraints'
);

SELECT * FROM finish(true);
ROLLBACK;





