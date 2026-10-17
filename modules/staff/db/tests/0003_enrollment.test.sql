BEGIN;
SELECT plan(35);

-- ── Superuser setup ──────────────────────────────────────────────────────────
-- Users: 0b organizer of org 1, 0c organizer of org 2, 0d and 0e staff members.
INSERT INTO identity.organizations (id, name, verified_at) VALUES
  ('00000000-0000-4000-8000-00000000000a', 'Org 1', now()),
  ('00000000-0000-4000-8000-0000000000aa', 'Org 2', now());
INSERT INTO identity.users (id, is_admin) VALUES
  ('00000000-0000-4000-8000-00000000000b', false),
  ('00000000-0000-4000-8000-00000000000c', false),
  ('00000000-0000-4000-8000-00000000000d', false),
  ('00000000-0000-4000-8000-00000000000e', false);
INSERT INTO identity.memberships (org_id, user_id) VALUES
  ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000b'),
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000000c');
INSERT INTO jurisdictions.jurisdictions (canton_code, name, tax_rate_bps, courtesy_deduct_bps, settlement_rule) VALUES
  ('TEST-01', 'Test', 0, '{}', 'next_business_day');
INSERT INTO events.events (id, org_id, canton_code, name, venue_name, starts_at, age_rating, permitted_capacity, status, published_at) VALUES
  ('00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-00000000000a', 'TEST-01', 'Event 1', 'Venue', now() + interval '1 day', 'all', 10, 'on_sale', now()),
  ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-0000000000aa', 'TEST-01', 'Event 2', 'Venue', now() + interval '1 day', 'all', 10, 'on_sale', now());

-- ── create_code ──────────────────────────────────────────────────────────────
SET LOCAL SESSION AUTHORIZATION passripple_api;
SELECT identity.set_actor('00000000-0000-4000-8000-00000000000b', 'organizer', '00000000-0000-4000-8000-00000000000a');

SELECT set_config('test.code1', staff.create_code('00000000-0000-4000-8000-000000000010',
  '\x0100000000000000000000000000000000000000000000000000000000000000', 'gate', NULL,
  now(), now() + interval '1 day', 10)::text, true);
SELECT isnt(current_setting('test.code1'), '', 'an organizer creates a code for their event');

SELECT throws_ok(
  $$ SELECT staff.create_code('00000000-0000-4000-8000-000000000010', '\x0100000000000000000000000000000000000000000000000000000000000000',
       'gate', NULL, now(), now() + interval '1 day', 10) $$,
  '23505', NULL, 'two codes never share a hash'
);
SELECT throws_ok(
  $$ SELECT staff.create_code('00000000-0000-4000-8000-000000000010', '\x0200000000000000000000000000000000000000000000000000000000000000',
       'gate', NULL, now(), now() + interval '1 day', 0) $$,
  '23514', NULL, 'max_uses below 1 is rejected'
);
SELECT throws_ok(
  $$ SELECT staff.create_code('00000000-0000-4000-8000-000000000010', '\x0200000000000000000000000000000000000000000000000000000000000000',
       'gate', NULL, now(), now() + interval '1 day', 1001) $$,
  '23514', NULL, 'max_uses above 1000 is rejected'
);
SELECT throws_ok(
  $$ SELECT staff.create_code('00000000-0000-4000-8000-000000000010', '\x0200000000000000000000000000000000000000000000000000000000000000',
       'gate', NULL, now(), now(), 10) $$,
  '23514', NULL, 'a window that ends when it starts is rejected'
);

SELECT identity.set_actor('00000000-0000-4000-8000-00000000000c', 'organizer', '00000000-0000-4000-8000-0000000000aa');
SELECT throws_ok(
  $$ SELECT staff.create_code('00000000-0000-4000-8000-000000000010', '\x0300000000000000000000000000000000000000000000000000000000000000',
       'gate', NULL, now(), now() + interval '1 day', 10) $$,
  '42501', NULL, 'an organizer of another org cannot create a code for the event'
);

SELECT identity.set_actor('00000000-0000-4000-8000-00000000000d', 'staff');
SELECT throws_ok(
  $$ SELECT staff.create_code('00000000-0000-4000-8000-000000000010', '\x0400000000000000000000000000000000000000000000000000000000000000',
       'gate', NULL, now(), now() + interval '1 day', 10) $$,
  '42501', NULL, 'a staff member cannot create codes'
);

-- ── revoke_code ──────────────────────────────────────────────────────────────
SELECT identity.set_actor('00000000-0000-4000-8000-00000000000c', 'organizer', '00000000-0000-4000-8000-0000000000aa');
SELECT throws_ok(
  format('SELECT staff.revoke_code(%L)', current_setting('test.code1')),
  '42501', NULL, 'an organizer of another org cannot revoke the code'
);

SELECT identity.set_actor('00000000-0000-4000-8000-00000000000b', 'organizer', '00000000-0000-4000-8000-00000000000a');
SELECT staff.revoke_code(current_setting('test.code1')::uuid);
SELECT isnt(
  (SELECT revoked_at FROM staff.staff_codes WHERE id = current_setting('test.code1')::uuid),
  NULL,
  'the organizer revokes the code'
);

-- Revocar dos veces conserva la primera fecha.
RESET SESSION AUTHORIZATION;
UPDATE staff.staff_codes SET revoked_at = '2020-01-01 00:00:00+00' WHERE id = current_setting('test.code1')::uuid;
SET LOCAL SESSION AUTHORIZATION passripple_api;
SELECT identity.set_actor('00000000-0000-4000-8000-00000000000b', 'organizer', '00000000-0000-4000-8000-00000000000a');
SELECT staff.revoke_code(current_setting('test.code1')::uuid);
SELECT is(
  (SELECT revoked_at FROM staff.staff_codes WHERE id = current_setting('test.code1')::uuid),
  '2020-01-01 00:00:00+00'::timestamptz,
  'revoking twice keeps the first date'
);

-- A code whose window opens in an hour, two uses; another already expired.
SELECT set_config('test.code5', staff.create_code('00000000-0000-4000-8000-000000000010',
  '\x0500000000000000000000000000000000000000000000000000000000000000', 'gate', 'Zone A',
  now() + interval '1 hour', now() + interval '1 day', 2)::text, true);
RESET SESSION AUTHORIZATION;
INSERT INTO staff.staff_codes (event_id, code_hash, role, valid_from, valid_until, max_uses, created_by) VALUES
  ('00000000-0000-4000-8000-000000000010', '\x0600000000000000000000000000000000000000000000000000000000000000', 'gate',
   now() - interval '2 days', now() - interval '1 day', 2, '00000000-0000-4000-8000-00000000000b');
SET LOCAL SESSION AUTHORIZATION passripple_api;

-- ── enroll ───────────────────────────────────────────────────────────────────
SELECT identity.set_actor('00000000-0000-4000-8000-00000000000b', 'organizer', '00000000-0000-4000-8000-00000000000a');
SELECT throws_ok(
  $$ SELECT staff.enroll('\x0500000000000000000000000000000000000000000000000000000000000000', '\x1000000000000000000000000000000000000000000000000000000000000000',
       'android', '1.0.0', 'none:') $$,
  '42501', NULL, 'only a staff member enrolls a device'
);

-- Enrolling before the window opens is allowed (staff download the manifest the day before).
SELECT identity.set_actor('00000000-0000-4000-8000-00000000000d', 'staff');
SELECT set_config('test.device1', staff.enroll('\x0500000000000000000000000000000000000000000000000000000000000000',
  '\x1100000000000000000000000000000000000000000000000000000000000000', 'android', '1.0.0', 'none:')::text, true);
SELECT isnt(current_setting('test.device1'), '', 'a staff member enrolls before the window opens');

RESET SESSION AUTHORIZATION;
SELECT is(
  (SELECT uses FROM staff.staff_codes WHERE id = current_setting('test.code5')::uuid),
  1,
  'enrolling consumes a use'
);
SELECT row_eq(
  format($$SELECT event_id, user_id, role, zone, platform, app_version, staff_code_id, integrity
             FROM staff.staff_devices WHERE id = %L$$, current_setting('test.device1')),
  ROW('00000000-0000-4000-8000-000000000010'::uuid, '00000000-0000-4000-8000-00000000000d'::uuid, 'gate'::text,
      'Zone A'::text, 'android'::text, '1.0.0'::text, current_setting('test.code5')::uuid, 'none:'::text),
  'the device takes the code''s event, role and zone, and the phone''s details'
);
SELECT is(
  (SELECT device_id FROM staff.device_sessions WHERE token_hash = '\x1100000000000000000000000000000000000000000000000000000000000000'),
  current_setting('test.device1')::uuid,
  'the device gets a session for its token'
);
SET LOCAL SESSION AUTHORIZATION passripple_api;
SELECT identity.set_actor('00000000-0000-4000-8000-00000000000d', 'staff');

-- An unknown, revoked, used-up or expired code gets the same error (P0002).
SELECT staff.enroll('\x0500000000000000000000000000000000000000000000000000000000000000',
  '\x1200000000000000000000000000000000000000000000000000000000000000', 'ios', '1.0.0', 'none:');
SELECT throws_ok(
  $$ SELECT staff.enroll('\x0500000000000000000000000000000000000000000000000000000000000000', '\x1300000000000000000000000000000000000000000000000000000000000000',
       'android', '1.0.0', 'none:') $$,
  'P0002', 'staff code not valid', 'a used-up code is rejected'
);
SELECT throws_ok(
  $$ SELECT staff.enroll('\x0100000000000000000000000000000000000000000000000000000000000000', '\x1400000000000000000000000000000000000000000000000000000000000000',
       'android', '1.0.0', 'none:') $$,
  'P0002', 'staff code not valid', 'a revoked code is rejected'
);
SELECT throws_ok(
  $$ SELECT staff.enroll('\x0600000000000000000000000000000000000000000000000000000000000000', '\x1500000000000000000000000000000000000000000000000000000000000000',
       'android', '1.0.0', 'none:') $$,
  'P0002', 'staff code not valid', 'an expired code is rejected'
);
SELECT throws_ok(
  $$ SELECT staff.enroll('\x0700000000000000000000000000000000000000000000000000000000000000', '\x1600000000000000000000000000000000000000000000000000000000000000',
       'android', '1.0.0', 'none:') $$,
  'P0002', 'staff code not valid', 'an unknown code is rejected'
);

-- ── authenticate_device ──────────────────────────────────────────────────────
SELECT is(
  (SELECT status FROM staff.authenticate_device('\x1100000000000000000000000000000000000000000000000000000000000000')),
  'active',
  'an enrolled device inside or before its window is active'
);

RESET SESSION AUTHORIZATION;
-- Devices 32 (revoked), 33 (expired), 34 (expired over 30 days ago) of staff member 0e.
INSERT INTO staff.staff_devices (id, event_id, user_id, role, valid_from, valid_until, revoked_at) VALUES
  ('00000000-0000-4000-8000-000000000032', '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-00000000000e', 'gate', now() - interval '1 day', now() + interval '1 day', now()),
  ('00000000-0000-4000-8000-000000000033', '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-00000000000e', 'gate', now() - interval '2 days', now() - interval '1 day', NULL),
  ('00000000-0000-4000-8000-000000000034', '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-00000000000e', 'gate', now() - interval '40 days', now() - interval '31 days', NULL);
INSERT INTO staff.device_sessions (token_hash, device_id) VALUES
  ('\x3200000000000000000000000000000000000000000000000000000000000000', '00000000-0000-4000-8000-000000000032'),
  ('\x3300000000000000000000000000000000000000000000000000000000000000', '00000000-0000-4000-8000-000000000033'),
  ('\x3400000000000000000000000000000000000000000000000000000000000000', '00000000-0000-4000-8000-000000000034');
SET LOCAL SESSION AUTHORIZATION passripple_api;

SELECT is(
  (SELECT status FROM staff.authenticate_device('\x3200000000000000000000000000000000000000000000000000000000000000')),
  'revoked', 'a revoked device authenticates as revoked, to drain its queue'
);
SELECT is(
  (SELECT status FROM staff.authenticate_device('\x3300000000000000000000000000000000000000000000000000000000000000')),
  'expired', 'a device past its window authenticates as expired'
);
SELECT is(
  (SELECT count(*)::int FROM staff.authenticate_device('\x3400000000000000000000000000000000000000000000000000000000000000')),
  0, 'thirty days after its window a device no longer authenticates'
);

-- ── sign_out_device ──────────────────────────────────────────────────────────
SELECT identity.set_actor('00000000-0000-4000-8000-00000000000e', 'staff');
SELECT throws_ok(
  format('SELECT staff.sign_out_device(%L)', current_setting('test.device1')),
  '42501', NULL, 'a staff member cannot sign out another person''s device'
);

SELECT identity.set_actor('00000000-0000-4000-8000-00000000000d', 'staff');
SELECT staff.sign_out_device(current_setting('test.device1')::uuid);
SELECT is(
  (SELECT count(*)::int FROM staff.authenticate_device('\x1100000000000000000000000000000000000000000000000000000000000000')),
  0, 'a signed-out device no longer authenticates'
);
RESET SESSION AUTHORIZATION;
SELECT ok(
  (SELECT s.ended_at IS NOT NULL AND d.revoked_at IS NOT NULL
     FROM staff.device_sessions s JOIN staff.staff_devices d ON d.id = s.device_id
    WHERE d.id = current_setting('test.device1')::uuid),
  'signing out ends the session and revokes the device'
);
SET LOCAL SESSION AUTHORIZATION passripple_api;

-- ── What the API reads ───────────────────────────────────────────────────────
SELECT identity.set_actor('00000000-0000-4000-8000-00000000000b', 'organizer', '00000000-0000-4000-8000-00000000000a');
SELECT throws_ok($$ SELECT code_hash FROM staff.staff_codes $$, '42501', NULL, 'the API never reads code hashes');
SELECT throws_ok($$ SELECT token_hash FROM staff.device_sessions $$, '42501', NULL, 'the API never reads device sessions');
SELECT is(
  (SELECT count(*)::int FROM staff.staff_codes WHERE event_id = '00000000-0000-4000-8000-000000000010'),
  3, 'an organizer sees their event''s codes'
);
SELECT identity.set_actor('00000000-0000-4000-8000-00000000000c', 'organizer', '00000000-0000-4000-8000-0000000000aa');
SELECT is((SELECT count(*)::int FROM staff.staff_codes), 0, 'an organizer of another org sees none of them');

RESET SESSION AUTHORIZATION;

-- ── Concurrency (dblink) ─────────────────────────────────────────────────────
-- Two phones race for the last use of a code. Both must see the code, so a third
-- connection commits it, with ids of its own, and removes everything at the end.
CREATE FUNCTION pg_temp.cleanup_enroll() RETURNS text LANGUAGE sql AS $f$
  SELECT dblink_exec('setup', $c$
    SET session_replication_role = replica;
    DELETE FROM staff.device_sessions WHERE device_id IN
      (SELECT id FROM staff.staff_devices WHERE event_id = '00000000-0000-4000-8000-0000000c5010');
    DELETE FROM staff.staff_devices WHERE event_id = '00000000-0000-4000-8000-0000000c5010';
    DELETE FROM staff.staff_codes WHERE event_id = '00000000-0000-4000-8000-0000000c5010';
    DELETE FROM events.events WHERE id = '00000000-0000-4000-8000-0000000c5010';
    DELETE FROM identity.users WHERE id IN ('00000000-0000-4000-8000-0000000c500b', '00000000-0000-4000-8000-0000000c500d');
    DELETE FROM identity.organizations WHERE id = '00000000-0000-4000-8000-0000000c500a';
    DELETE FROM jurisdictions.jurisdictions WHERE canton_code = 'CONC-EN';
    RESET session_replication_role;
  $c$);
$f$;

SELECT dblink_connect(name, format('dbname=%s user=%s', current_database(),
                                   (SELECT rolname FROM pg_roles WHERE oid = 10)))
  FROM unnest(ARRAY['setup', 'a', 'b']) AS name;
SELECT pg_temp.cleanup_enroll();
SELECT dblink_exec('setup', $$
  INSERT INTO jurisdictions.jurisdictions (canton_code, name, tax_rate_bps, courtesy_deduct_bps, settlement_rule)
  VALUES ('CONC-EN', 'Enrollment', 0, '{}', 'next_business_day');
  INSERT INTO identity.organizations (id, name, verified_at)
  VALUES ('00000000-0000-4000-8000-0000000c500a', 'Enrollment org', now());
  INSERT INTO identity.users (id, is_admin) VALUES
    ('00000000-0000-4000-8000-0000000c500b', false), ('00000000-0000-4000-8000-0000000c500d', false);
  INSERT INTO events.events (id, org_id, canton_code, name, venue_name, starts_at, age_rating,
                             permitted_capacity, status, published_at)
  VALUES ('00000000-0000-4000-8000-0000000c5010', '00000000-0000-4000-8000-0000000c500a', 'CONC-EN',
          'Last use', 'Venue', now(), 'all', 10, 'on_sale', now());
  INSERT INTO staff.staff_codes (event_id, code_hash, role, valid_from, valid_until, max_uses, created_by)
  VALUES ('00000000-0000-4000-8000-0000000c5010', '\xc500000000000000000000000000000000000000000000000000000000000000',
          'gate', now(), now() + interval '1 day', 1, '00000000-0000-4000-8000-0000000c500b');
$$);

-- Both racers act as the API, as the same staff member.
SELECT dblink_exec(name, 'BEGIN'), dblink_exec(name, 'SET LOCAL SESSION AUTHORIZATION passripple_api'),
       (SELECT x FROM dblink(name, $$SELECT identity.set_actor('00000000-0000-4000-8000-0000000c500d', 'staff')::text$$) AS t(x text))
  FROM unnest(ARRAY['a', 'b']) AS name;

-- A takes the last use and keeps its transaction open, holding the code's row lock.
SELECT isnt(
  (SELECT x FROM dblink('a', $$SELECT staff.enroll('\xc500000000000000000000000000000000000000000000000000000000000000',
     '\xc5a0000000000000000000000000000000000000000000000000000000000000', 'android', '1.0.0', 'none:')::text$$) AS t(x text)),
  NULL,
  'the first phone takes the last use'
);
SELECT dblink_send_query('b', $$SELECT staff.enroll('\xc500000000000000000000000000000000000000000000000000000000000000',
  '\xc5b0000000000000000000000000000000000000000000000000000000000000', 'android', '1.0.0', 'none:')::text$$);
SELECT pg_sleep(0.3);
SELECT is(dblink_is_busy('b'), 1, 'the second enrollment waits for the code''s row lock');
SELECT dblink_exec('a', 'COMMIT');
SELECT is(
  (SELECT count(*)::int FROM dblink_get_result('b', false) AS t(x text)),
  0,
  'once the first commits, the second enrollment fails'
);
SELECT ok(dblink_error_message('b') LIKE '%staff code not valid%', 'the second phone finds the code used up');
SELECT * FROM dblink_get_result('b', false) AS t(x text);
SELECT dblink_exec('b', 'ROLLBACK');

SELECT is(
  (SELECT x FROM dblink('setup', $$SELECT uses::text FROM staff.staff_codes
     WHERE event_id = '00000000-0000-4000-8000-0000000c5010'$$) AS t(x text)),
  '1',
  'the code is used exactly once (max_uses holds under concurrency)'
);
SELECT pg_temp.cleanup_enroll();
SELECT dblink_disconnect(name) FROM unnest(ARRAY['setup', 'a', 'b']) AS name;

SELECT * FROM finish(true);
ROLLBACK;
