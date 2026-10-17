BEGIN;
SELECT plan(10);

-- ── Superuser setup ──────────────────────────────────────────────────────────
INSERT INTO identity.organizations (id, name, verified_at) VALUES
  ('00000000-0000-4000-8000-00000000000a', 'Org 1', now());
INSERT INTO identity.users (id, is_admin, email) VALUES
  ('00000000-0000-4000-8000-00000000000b', false, 'staff-a@example.com'),
  ('00000000-0000-4000-8000-00000000000c', false, 'staff-b@example.com'),
  ('00000000-0000-4000-8000-00000000000d', false, 'staff-c@example.com');
INSERT INTO jurisdictions.jurisdictions (canton_code, name, tax_rate_bps, courtesy_deduct_bps, settlement_rule) VALUES
  ('TEST-01', 'Test', 0, '{}', 'next_business_day');
INSERT INTO events.events (id, org_id, canton_code, name, venue_name, starts_at, age_rating, permitted_capacity, status, published_at) VALUES
  ('00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-00000000000a', 'TEST-01', 'Event 1', 'Venue', now() - interval '60 days', 'all', 10, 'on_sale', now());

-- A: a phone inside its window, with an open session.
-- B: a phone whose window ended 35 days ago, session never closed (a lost phone).
-- C: a phone of another person, inside its window.
INSERT INTO staff.staff_devices (id, event_id, user_id, role, valid_from, valid_until) VALUES
  ('00000000-0000-4000-8000-000000000030', '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-00000000000b', 'gate', now() - interval '1 day', now() + interval '1 day'),
  ('00000000-0000-4000-8000-000000000031', '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-00000000000c', 'gate', now() - interval '40 days', now() - interval '35 days'),
  ('00000000-0000-4000-8000-000000000032', '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-00000000000d', 'gate', now() - interval '1 day', now() + interval '1 day');
INSERT INTO staff.device_sessions (token_hash, device_id) VALUES
  ('\x0100000000000000000000000000000000000000000000000000000000000000', '00000000-0000-4000-8000-000000000030'),
  ('\x0200000000000000000000000000000000000000000000000000000000000000', '00000000-0000-4000-8000-000000000031'),
  ('\x0300000000000000000000000000000000000000000000000000000000000000', '00000000-0000-4000-8000-000000000032');

-- ── API actions ──────────────────────────────────────────────────────────────
SET LOCAL SESSION AUTHORIZATION passripple_api;

SELECT identity.set_actor(NULL, 'system');
SELECT throws_ok($$ SELECT staff.release_user_devices() $$, '42501', NULL, 'the system releases nobody''s devices');
SELECT identity.set_actor(NULL, 'buyer');
SELECT throws_ok($$ SELECT staff.release_user_devices() $$, '42501', NULL, 'a buyer releases no devices');

-- A phone still able to upload blocks the erasure (I6).
SELECT identity.set_actor('00000000-0000-4000-8000-00000000000b', 'staff');
SELECT throws_ok(
  $$ SELECT staff.release_user_devices() $$,
  '55006', NULL, 'a phone inside its upload window blocks the release'
);

-- Signing the phone out from the app (queue empty) lifts the block.
SELECT staff.sign_out_device('00000000-0000-4000-8000-000000000030');
SELECT is(staff.release_user_devices(), 1, 'after signing out, the release revokes the device');

-- A lost phone stops counting 30 days after its window.
SELECT identity.set_actor('00000000-0000-4000-8000-00000000000c', 'staff');
SELECT is(staff.release_user_devices(), 1, 'a phone whose window ended over 30 days ago does not block');

RESET SESSION AUTHORIZATION;

SELECT is(
  (SELECT count(*)::int FROM staff.staff_devices
    WHERE user_id IN ('00000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-00000000000c')
      AND revoked_at IS NULL),
  0,
  'the released people''s devices are revoked'
);
SELECT is(
  (SELECT count(*)::int FROM staff.device_sessions
    WHERE device_id IN ('00000000-0000-4000-8000-000000000030', '00000000-0000-4000-8000-000000000031')
      AND ended_at IS NULL),
  0,
  'their sessions are ended'
);
SELECT is(
  (SELECT revoked_at FROM staff.staff_devices WHERE id = '00000000-0000-4000-8000-000000000032'),
  NULL,
  'another person''s device is untouched'
);
SELECT is(
  (SELECT ended_at FROM staff.device_sessions WHERE device_id = '00000000-0000-4000-8000-000000000032'),
  NULL,
  'another person''s session is untouched'
);
SELECT is(
  (SELECT status FROM staff.authenticate_device('\x0100000000000000000000000000000000000000000000000000000000000000')),
  NULL,
  'a released device no longer authenticates'
);

SELECT * FROM finish(true);
ROLLBACK;
