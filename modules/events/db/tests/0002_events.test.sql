BEGIN;
SELECT plan(15);

-- ── Superuser setup ──────────────────────────────────────────────────────────
INSERT INTO identity.organizations (id, name, verified_at) VALUES
  ('00000000-0000-4000-8000-00000000000a', 'Org 1', now()),
  ('00000000-0000-4000-8000-00000000000b', 'Org 2', NULL);

INSERT INTO identity.users (id, is_admin) VALUES
  ('00000000-0000-4000-8000-00000000000c', false),
  ('00000000-0000-4000-8000-00000000000d', false);

INSERT INTO identity.memberships (org_id, user_id) VALUES
  ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000c'),
  ('00000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-00000000000d');

INSERT INTO jurisdictions.jurisdictions (canton_code, name, tax_rate_bps, courtesy_deduct_bps, settlement_rule) VALUES
  ('TEST-01', 'Test', 0, '{}', 'next_business_day');

INSERT INTO events.events (id, org_id, canton_code, name, venue_name, starts_at, age_rating, permitted_capacity, permit_number) VALUES
  ('00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-00000000000a', 'TEST-01', 'Event 1', 'Venue', now(), 'all', 100, 'PERMIT1'),
  ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-00000000000b', 'TEST-01', 'Event 2', 'Venue', now(), 'all', 100, NULL);

-- ── API actions ──────────────────────────────────────────────────────────────
SET LOCAL SESSION AUTHORIZATION passripple_api;

SELECT identity.set_actor('00000000-0000-4000-8000-00000000000d', 'organizer');

SELECT is((SELECT count(*)::int FROM events.events WHERE id = '00000000-0000-4000-8000-000000000010'), 0, 'organizer cannot see draft event of another org');

SELECT throws_ok(
  $$ INSERT INTO events.events (org_id, canton_code, name, venue_name, starts_at, age_rating, permitted_capacity) VALUES ('00000000-0000-4000-8000-00000000000a', 'TEST-01', 'Ev', 'Ve', now(), 'all', 10) $$,
  '42501', NULL, 'organizer cannot insert event for another org'
);

WITH updated AS (UPDATE events.events SET name = 'Hacked' WHERE id = '00000000-0000-4000-8000-000000000010' RETURNING 1)
SELECT is((SELECT count(*)::int FROM updated), 0, 'organizer cannot update event of another org (fails RLS)');

-- Note: they can't update org_id or status anyway because they are not GRANTED
SELECT throws_ok(
  $$ UPDATE events.events SET org_id = '00000000-0000-4000-8000-00000000000b' WHERE id = '00000000-0000-4000-8000-000000000011' $$,
  '42501', NULL, 'organizer cannot update org_id'
);
SELECT throws_ok(
  $$ UPDATE events.events SET status = 'on_sale' WHERE id = '00000000-0000-4000-8000-000000000011' $$,
  '42501', NULL, 'organizer cannot update status'
);

-- Publish rules
SELECT throws_ok(
  $$ SELECT events.publish('00000000-0000-4000-8000-000000000011') $$,
  '55000', NULL, 'cannot publish if organization is not verified'
);

SELECT identity.set_actor('00000000-0000-4000-8000-00000000000c', 'organizer');
-- Event 1 has a permit, so we remove it to test
UPDATE events.events SET permit_number = NULL WHERE id = '00000000-0000-4000-8000-000000000010';
SELECT throws_ok(
  $$ SELECT events.publish('00000000-0000-4000-8000-000000000010') $$,
  '55000', NULL, 'cannot publish without a permit number'
);

UPDATE events.events SET permit_number = 'PERMIT1' WHERE id = '00000000-0000-4000-8000-000000000010';

SELECT identity.set_actor('00000000-0000-4000-8000-00000000000d', 'organizer');
SELECT throws_ok(
  $$ SELECT events.publish('00000000-0000-4000-8000-000000000010') $$,
  '42501', NULL, 'cannot publish event from another organization'
);

SELECT identity.set_actor('00000000-0000-4000-8000-00000000000c', 'organizer');
SELECT lives_ok($$ SELECT events.publish('00000000-0000-4000-8000-000000000010') $$, 'publish succeeds');

SELECT throws_ok(
  $$ SELECT events.publish('00000000-0000-4000-8000-000000000010') $$,
  '55000', NULL, 'cannot publish twice'
);

-- Actor NULL
SELECT set_config('app.actor_id', NULL, true);
SELECT set_config('app.actor_role', NULL, true);
SELECT set_config('app.org_id', NULL, true);
SELECT throws_ok(
  $$ SELECT events.publish('00000000-0000-4000-8000-000000000010') $$,
  '42501', NULL, 'cannot publish with NULL actor'
);
SELECT is((SELECT count(*)::int FROM events.events WHERE id = '00000000-0000-4000-8000-000000000011'), 0, 'NULL actor cannot see drafts');

-- A buyer can only see published events
SELECT identity.set_actor(NULL, 'buyer');
SELECT is((SELECT count(*)::int FROM events.events WHERE id = '00000000-0000-4000-8000-000000000010'), 1, 'buyer sees published event');
SELECT is((SELECT count(*)::int FROM events.events WHERE id = '00000000-0000-4000-8000-000000000011'), 0, 'buyer cannot see draft event');

RESET SESSION AUTHORIZATION;
SELECT * FROM finish(true);
ROLLBACK;





