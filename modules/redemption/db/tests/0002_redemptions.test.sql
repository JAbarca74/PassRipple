BEGIN;
SELECT plan(19);

-- ── Superuser setup ──────────────────────────────────────────────────────────
INSERT INTO identity.organizations (id, name, verified_at) VALUES
  ('00000000-0000-4000-8000-00000000000a', 'Org 1', now());
INSERT INTO identity.users (id, is_admin) VALUES
  ('00000000-0000-4000-8000-00000000000b', false),
  ('00000000-0000-4000-8000-00000000000c', false);
INSERT INTO jurisdictions.jurisdictions (canton_code, name, tax_rate_bps, courtesy_deduct_bps, settlement_rule) VALUES
  ('TEST-01', 'Test', 0, '{}', 'next_business_day');
INSERT INTO events.events (id, org_id, canton_code, name, venue_name, starts_at, age_rating, permitted_capacity, status, published_at) VALUES
  ('00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-00000000000a', 'TEST-01', 'Event 1', 'Venue', now(), 'all', 10, 'on_sale', now()),
  ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-00000000000a', 'TEST-01', 'Event 2', 'Venue', now(), 'all', 10, 'on_sale', now());

INSERT INTO catalog.ticket_types (id, event_id, name, price_crc, audience, entry_mode) VALUES
  ('00000000-0000-4000-8000-000000000020', '00000000-0000-4000-8000-000000000010', 'Public 1', 1000, 'public', 'single_use'),
  ('00000000-0000-4000-8000-000000000021', '00000000-0000-4000-8000-000000000010', 'Staff 1', 0, 'staff', 'multi_scan'),
  ('00000000-0000-4000-8000-000000000022', '00000000-0000-4000-8000-000000000011', 'Public 2', 1000, 'public', 'single_use');

INSERT INTO staff.staff_devices (id, event_id, user_id, role, valid_from, valid_until) VALUES
  ('00000000-0000-4000-8000-000000000030', '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-00000000000b', 'gate', now() - interval '1 day', now() + interval '1 day'),
  ('00000000-0000-4000-8000-000000000031', '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-00000000000b', 'gate', now() - interval '1 day', now() + interval '1 day');

INSERT INTO ticketing.tickets (id, event_id, ticket_type_id, origin, code_human) VALUES
  ('00000000-0000-4000-8000-000000000040', '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000020', 'courtesy', 'C0DE40'),
  ('00000000-0000-4000-8000-000000000041', '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000021', 'courtesy', 'C0DE41'),
  ('00000000-0000-4000-8000-000000000042', '00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000022', 'courtesy', 'C0DE42'),
  ('00000000-0000-4000-8000-000000000043', '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000020', 'courtesy', 'C0DE43');

-- ── API actions ──────────────────────────────────────────────────────────────
SET LOCAL SESSION AUTHORIZATION passripple_api;

SELECT identity.set_actor('00000000-0000-4000-8000-00000000000c', 'staff');
SELECT throws_ok(
  $$ SELECT redemption.record_scan('00000000-0000-4000-8000-000000000050', '00000000-0000-4000-8000-000000000040', '00000000-0000-4000-8000-000000000030', 1, now(), 0, 'qr', false) $$,
  '42501', NULL, 'staff using another device raises exception'
);

SELECT identity.set_actor('00000000-0000-4000-8000-00000000000b', 'staff');

SELECT throws_ok(
  $$ SELECT redemption.record_scan('00000000-0000-4000-8000-000000000050', '00000000-0000-4000-8000-000000000042', '00000000-0000-4000-8000-000000000030', 1, now(), 0, 'qr', false) $$,
  '23503', NULL, 'ticket of another event than device'
);

SELECT is(
  (SELECT redemption.record_scan('00000000-0000-4000-8000-000000000050', '00000000-0000-4000-8000-000000000040', '00000000-0000-4000-8000-000000000030', 1, now(), 0, 'qr', false)),
  'admitted',
  'valid scan returns admitted'
);

-- Same scan ID twice
SELECT is(
  (SELECT redemption.record_scan('00000000-0000-4000-8000-000000000050', '00000000-0000-4000-8000-000000000040', '00000000-0000-4000-8000-000000000030', 1, now(), 0, 'qr', false)),
  'admitted',
  'same scan ID returns original outcome'
);

-- Reused device seq
SELECT throws_ok(
  $$ SELECT redemption.record_scan('00000000-0000-4000-8000-000000000051', '00000000-0000-4000-8000-000000000040', '00000000-0000-4000-8000-000000000030', 1, now(), 0, 'qr', false) $$,
  '23505', NULL, 'reused device seq throws unique violation'
);

-- Different scan, same ticket -> duplicate
SELECT is(
  (SELECT redemption.record_scan('00000000-0000-4000-8000-000000000052', '00000000-0000-4000-8000-000000000040', '00000000-0000-4000-8000-000000000030', 2, now(), 0, 'qr', false)),
  'duplicate',
  'second scan of single use returns duplicate'
);

-- Faking multi_scan via direct INSERT by owner
RESET SESSION AUTHORIZATION;
SET LOCAL ROLE passripple_owner_redemption;
-- Trigger overrides entry_mode to single_use, hitting the unique index
SELECT throws_ok(
  $$ INSERT INTO redemption.redemptions (id, ticket_id, device_id, device_seq, scanned_at_device, method, entry_mode, outcome) VALUES
  ('00000000-0000-4000-8000-000000000053', '00000000-0000-4000-8000-000000000040', '00000000-0000-4000-8000-000000000030', 3, now(), 'qr', 'multi_scan', 'admitted') $$,
  '23505', NULL, 'trigger overrides entry_mode to single_use causing unique violation'
);

-- Converting duplicate to admitted
SELECT throws_ok(
  $$ UPDATE redemption.redemptions SET outcome = 'admitted' WHERE id = '00000000-0000-4000-8000-000000000052' $$,
  '23001', NULL, 'owner cannot UPDATE redemptions'
);
-- Deleting
SELECT throws_ok(
  $$ DELETE FROM redemption.redemptions WHERE id = '00000000-0000-4000-8000-000000000050' $$,
  '23001', NULL, 'owner cannot DELETE redemptions'
);
-- Multiple admitted for single use by owner INSERT bypassing API
SELECT throws_ok(
  $$ INSERT INTO redemption.redemptions (id, ticket_id, device_id, device_seq, scanned_at_device, method, outcome) VALUES ('00000000-0000-4000-8000-000000000054', '00000000-0000-4000-8000-000000000040', '00000000-0000-4000-8000-000000000030', 4, now(), 'qr', 'admitted') $$,
  '23505', NULL, 'owner inserting second admitted for single_use fails UNIQUE constraint'
);

RESET ROLE;

-- ── Concurrency (ADR 0011) ───────────────────────────────────────────────────
-- Two gate devices scan the same single-use ticket at the same time on two real
-- connections. Both must see the data, so a third connection commits it, with ids and
-- a canton of its own, and removes it at the end. The cleanup runs first too, in case
-- an earlier run stopped halfway; it disables triggers because scans are append-only.
RESET SESSION AUTHORIZATION;
CREATE FUNCTION pg_temp.cleanup_i1() RETURNS text LANGUAGE sql AS $f$
  SELECT dblink_exec('setup', $c$
    SET session_replication_role = replica;
    DELETE FROM redemption.redemptions WHERE ticket_id = '00000000-0000-4000-8000-0000000c1040';
    DELETE FROM ticketing.tickets WHERE id = '00000000-0000-4000-8000-0000000c1040';
    DELETE FROM staff.staff_devices WHERE event_id = '00000000-0000-4000-8000-0000000c1010';
    DELETE FROM catalog.ticket_types WHERE event_id = '00000000-0000-4000-8000-0000000c1010';
    DELETE FROM events.events WHERE id = '00000000-0000-4000-8000-0000000c1010';
    DELETE FROM identity.users WHERE id = '00000000-0000-4000-8000-0000000c100b';
    DELETE FROM identity.organizations WHERE id = '00000000-0000-4000-8000-0000000c100a';
    DELETE FROM jurisdictions.jurisdictions WHERE canton_code = 'CONC-I1';
    RESET session_replication_role;
  $c$);
$f$;

SELECT dblink_connect(name, format('dbname=%s user=%s', current_database(),
                                   (SELECT rolname FROM pg_roles WHERE oid = 10)))
  FROM unnest(ARRAY['setup', 'a', 'b']) AS name;
SELECT pg_temp.cleanup_i1();
SELECT dblink_exec('setup', $$
  INSERT INTO jurisdictions.jurisdictions (canton_code, name, tax_rate_bps, courtesy_deduct_bps, settlement_rule)
  VALUES ('CONC-I1', 'Concurrency', 0, '{}', 'next_business_day');
  INSERT INTO identity.organizations (id, name, verified_at)
  VALUES ('00000000-0000-4000-8000-0000000c100a', 'Concurrency org', now());
  INSERT INTO identity.users (id) VALUES ('00000000-0000-4000-8000-0000000c100b');
  INSERT INTO events.events (id, org_id, canton_code, name, venue_name, starts_at, age_rating,
                             permitted_capacity, status, published_at, permit_number)
  VALUES ('00000000-0000-4000-8000-0000000c1010', '00000000-0000-4000-8000-0000000c100a', 'CONC-I1',
          'Two gates', 'Venue', now(), 'all', 10, 'on_sale', now(), 'P1');
  INSERT INTO catalog.ticket_types (id, event_id, name, price_crc, audience)
  VALUES ('00000000-0000-4000-8000-0000000c1020', '00000000-0000-4000-8000-0000000c1010', 'Public', 1000, 'public');
  INSERT INTO staff.staff_devices (id, event_id, user_id, role, valid_from, valid_until) VALUES
    ('00000000-0000-4000-8000-0000000c1031', '00000000-0000-4000-8000-0000000c1010',
     '00000000-0000-4000-8000-0000000c100b', 'gate', now() - interval '1 hour', now() + interval '1 day'),
    ('00000000-0000-4000-8000-0000000c1032', '00000000-0000-4000-8000-0000000c1010',
     '00000000-0000-4000-8000-0000000c100b', 'gate', now() - interval '1 hour', now() + interval '1 day');
  INSERT INTO ticketing.tickets (id, event_id, ticket_type_id, origin, code_human, entry_mode)
  VALUES ('00000000-0000-4000-8000-0000000c1040', '00000000-0000-4000-8000-0000000c1010',
          '00000000-0000-4000-8000-0000000c1020', 'courtesy', 'C0NC1040', 'single_use');
$$);

-- Both racers act as the API, as the staff member who owns both devices.
SELECT dblink_exec(name, 'BEGIN'), dblink_exec(name, 'SET LOCAL SESSION AUTHORIZATION passripple_api'),
       (SELECT x FROM dblink(name, $$SELECT identity.set_actor('00000000-0000-4000-8000-0000000c100b', 'staff')::text$$)
          AS t(x text))
  FROM unnest(ARRAY['a', 'b']) AS name;

-- Gate A admits the ticket and keeps its transaction open.
SELECT is(
  (SELECT r FROM dblink('a', $$SELECT redemption.record_scan('00000000-0000-7000-8000-0000000c1061',
     '00000000-0000-4000-8000-0000000c1040', '00000000-0000-4000-8000-0000000c1031', 1, now(), 0, 'qr', false)$$)
     AS t(r text)),
  'admitted',
  'the first gate admits the ticket'
);
SELECT dblink_send_query('b', $$SELECT redemption.record_scan('00000000-0000-7000-8000-0000000c1062',
  '00000000-0000-4000-8000-0000000c1040', '00000000-0000-4000-8000-0000000c1032', 1, now(), 0, 'qr', false)$$);
SELECT pg_sleep(0.3);
SELECT is(dblink_is_busy('b'), 1, 'the second gate waits for the first admission');
SELECT dblink_exec('a', 'COMMIT');
SELECT is(
  (SELECT r FROM dblink_get_result('b') AS t(r text)),
  'duplicate',
  'once the first commits, the second scan is recorded as a duplicate'
);
SELECT * FROM dblink_get_result('b') AS t(r text);
SELECT dblink_exec('b', 'COMMIT');
SELECT is(
  (SELECT count(*)::int FROM redemption.redemptions
    WHERE ticket_id = '00000000-0000-4000-8000-0000000c1040' AND outcome = 'admitted'),
  1,
  'the ticket was admitted exactly once'
);

SELECT pg_temp.cleanup_i1();
SELECT dblink_disconnect(name) FROM unnest(ARRAY['setup', 'a', 'b']) AS name;

SELECT * FROM finish(true);
ROLLBACK;
