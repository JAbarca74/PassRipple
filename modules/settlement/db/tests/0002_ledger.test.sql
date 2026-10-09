BEGIN;
SELECT plan(13);

-- ── Superuser setup ──────────────────────────────────────────────────────────
INSERT INTO identity.organizations (id, name, verified_at) VALUES
  ('00000000-0000-4000-8000-00000000000a', 'Org 1', now()),
  ('00000000-0000-4000-8000-00000000000b', 'Org 2', now());

INSERT INTO identity.users (id, is_admin) VALUES
  ('00000000-0000-4000-8000-00000000000c', false),
  ('00000000-0000-4000-8000-00000000000d', false),
  ('00000000-0000-4000-8000-00000000000e', true);

INSERT INTO identity.memberships (org_id, user_id) VALUES
  ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000c'),
  ('00000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-00000000000d');

INSERT INTO jurisdictions.jurisdictions (canton_code, name, tax_rate_bps, courtesy_deduct_bps, settlement_rule) VALUES
  ('TEST-01', 'Test', 0, '{}', 'next_business_day');

INSERT INTO events.events (id, org_id, canton_code, name, venue_name, starts_at, age_rating, permitted_capacity, status, published_at) VALUES
  ('00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-00000000000a', 'TEST-01', 'Event 1', 'Venue', now(), 'all', 10, 'on_sale', now()),
  ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-00000000000b', 'TEST-01', 'Event 2', 'Venue', now(), 'all', 10, 'on_sale', now());

INSERT INTO settlement.ledger_entries (id, event_id, kind, amount_crc) VALUES
  ('00000000-0000-4000-8000-000000000020', '00000000-0000-4000-8000-000000000010', 'payment_in', 1000);

-- ── API actions ──────────────────────────────────────────────────────────────
SET LOCAL SESSION AUTHORIZATION passripple_api;

SELECT identity.set_actor('00000000-0000-4000-8000-00000000000d', 'organizer');
SELECT is((SELECT count(*)::int FROM settlement.ledger_entries WHERE id = '00000000-0000-4000-8000-000000000020'), 0, 'organizer cannot see ledger of another org');

SELECT identity.set_actor(NULL, 'system');
SELECT throws_ok(
  $$ SELECT settlement.record_entry('00000000-0000-4000-8000-000000000010', 'adjustment', 100, NULL, 'reason') $$,
  '42501', NULL, 'system cannot record adjustments'
);
SELECT throws_ok(
  $$ SELECT settlement.record_entry('00000000-0000-4000-8000-000000000010', 'payment_in', 0, NULL, NULL) $$,
  '23514', NULL, 'amount_crc cannot be 0'
);

SELECT identity.set_actor('00000000-0000-4000-8000-00000000000e', 'admin');
SELECT throws_ok(
  $$ SELECT settlement.record_entry('00000000-0000-4000-8000-000000000010', 'adjustment', 100, NULL, '') $$,
  '23514', NULL, 'adjustment without reason raises check_violation'
);

SELECT throws_ok(
  $$ UPDATE settlement.ledger_entries SET amount_crc = 2000 WHERE id = '00000000-0000-4000-8000-000000000020' $$,
  '42501', NULL, 'API cannot UPDATE ledger'
);

-- Superuser checks
RESET SESSION AUTHORIZATION;
SET LOCAL ROLE passripple_owner_settlement;

SELECT throws_ok(
  $$ UPDATE settlement.ledger_entries SET amount_crc = 2000 WHERE id = '00000000-0000-4000-8000-000000000020' $$,
  '23001', NULL, 'owner cannot UPDATE ledger'
);
SELECT throws_ok(
  $$ DELETE FROM settlement.ledger_entries WHERE id = '00000000-0000-4000-8000-000000000020' $$,
  '23001', NULL, 'owner cannot DELETE ledger'
);
SELECT throws_ok(
  $$ TRUNCATE settlement.ledger_entries $$,
  '23001', NULL, 'owner cannot TRUNCATE ledger'
);

RESET ROLE;

SELECT * FROM finish(true);
ROLLBACK;





