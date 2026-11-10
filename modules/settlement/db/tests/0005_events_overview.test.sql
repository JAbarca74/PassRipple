BEGIN;
SELECT plan(5);

-- ── Superuser setup ──────────────────────────────────────────────────────────
INSERT INTO identity.organizations (id, name, verified_at) VALUES
  ('00000000-0000-4000-8000-0000000006a1', 'Org A', now()),
  ('00000000-0000-4000-8000-0000000006a2', 'Org B', now());
INSERT INTO identity.users (id, is_admin) VALUES
  ('00000000-0000-4000-8000-0000000006b1', false),
  ('00000000-0000-4000-8000-0000000006b2', false),
  ('00000000-0000-4000-8000-0000000006b3', true);
INSERT INTO identity.memberships (org_id, user_id) VALUES
  ('00000000-0000-4000-8000-0000000006a1', '00000000-0000-4000-8000-0000000006b1'),
  ('00000000-0000-4000-8000-0000000006a2', '00000000-0000-4000-8000-0000000006b2');
INSERT INTO jurisdictions.jurisdictions (canton_code, name, tax_rate_bps, courtesy_deduct_bps, settlement_rule)
  VALUES ('TEST-06', 'Test', 0, '{}', 'next_business_day');

-- Org A: one event with money, one without. Org B: one event with money.
INSERT INTO events.events (id, org_id, canton_code, name, venue_name, starts_at, ends_at, age_rating, permitted_capacity, status, published_at) VALUES
  ('00000000-0000-4000-8000-0000000006e1', '00000000-0000-4000-8000-0000000006a1', 'TEST-06', 'A with money', 'V', now() - interval '5 days', now() - interval '4 days', 'all', 10, 'on_sale', now() - interval '9 days'),
  ('00000000-0000-4000-8000-0000000006e2', '00000000-0000-4000-8000-0000000006a1', 'TEST-06', 'A empty', 'V', now() + interval '5 days', now() + interval '6 days', 'all', 10, 'on_sale', now()),
  ('00000000-0000-4000-8000-0000000006e3', '00000000-0000-4000-8000-0000000006a2', 'TEST-06', 'B with money', 'V', now() - interval '3 days', now() - interval '2 days', 'all', 10, 'on_sale', now() - interval '9 days');
INSERT INTO settlement.ledger_entries (event_id, kind, amount_crc, reference) VALUES
  ('00000000-0000-4000-8000-0000000006e1', 'payment_in', 5000, 'R1'),
  ('00000000-0000-4000-8000-0000000006e1', 'fee', -300, 'R1'),
  ('00000000-0000-4000-8000-0000000006e1', 'door_sale', 2000, NULL),
  ('00000000-0000-4000-8000-0000000006e3', 'payment_in', 7000, 'R2');

SET LOCAL SESSION AUTHORIZATION passripple_api;

SELECT identity.set_actor('00000000-0000-4000-8000-0000000006b1', 'organizer', '00000000-0000-4000-8000-0000000006a1');
SELECT results_eq(
  $$ SELECT name, collected_crc, balance_crc, payout_paid_at IS NULL FROM settlement.events_overview() $$,
  $$ VALUES ('A empty'::text, 0, 0, true), ('A with money'::text, 5000, 4700, true) $$,
  'an organizer sees every event of their organization, latest end first, door sales left out'
);

SELECT identity.set_actor('00000000-0000-4000-8000-0000000006b2', 'organizer', '00000000-0000-4000-8000-0000000006a2');
SELECT results_eq(
  $$ SELECT name FROM settlement.events_overview() $$,
  $$ VALUES ('B with money'::text) $$,
  'another organization sees only its own events'
);

SELECT identity.set_actor('00000000-0000-4000-8000-0000000006b3', 'admin');
SELECT results_eq(
  $$ SELECT name FROM settlement.events_overview() $$,
  $$ VALUES ('B with money'::text), ('A with money'::text) $$,
  'an administrator sees every event that moved money'
);

SELECT ok(
  (SELECT due_at > ends_at FROM settlement.events_overview() WHERE name = 'A with money'),
  'the deadline comes after the event ends'
);

SELECT identity.set_actor(NULL, 'system');
SELECT throws_ok(
  $$ SELECT * FROM settlement.events_overview() $$,
  '42501', NULL, 'the system actor does not read settlements'
);

SELECT * FROM finish();
ROLLBACK;
