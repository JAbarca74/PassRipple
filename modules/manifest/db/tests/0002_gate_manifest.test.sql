BEGIN;
SELECT plan(17);

-- ── Superuser setup ──────────────────────────────────────────────────────────
-- Users: 0b and 0c staff members, 0d organizer of org 1.
INSERT INTO identity.organizations (id, name, verified_at) VALUES
  ('00000000-0000-4000-8000-00000000000a', 'Org 1', now());
INSERT INTO identity.users (id, is_admin) VALUES
  ('00000000-0000-4000-8000-00000000000b', false),
  ('00000000-0000-4000-8000-00000000000c', false),
  ('00000000-0000-4000-8000-00000000000d', false);
INSERT INTO identity.memberships (org_id, user_id) VALUES
  ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000d');
INSERT INTO jurisdictions.jurisdictions (canton_code, name, tax_rate_bps, courtesy_deduct_bps, settlement_rule) VALUES
  ('TEST-01', 'Test', 0, '{}', 'next_business_day');
INSERT INTO events.events (id, org_id, canton_code, name, venue_name, starts_at, age_rating, permitted_capacity, status, published_at) VALUES
  ('00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-00000000000a', 'TEST-01', 'Event 1', 'Venue', now(), '18plus', 10, 'on_sale', now()),
  ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-00000000000a', 'TEST-01', 'Event 2', 'Venue', now(), 'all', 10, 'on_sale', now());

INSERT INTO catalog.ticket_types (id, event_id, name, price_crc, audience, entry_mode, zone) VALUES
  ('00000000-0000-4000-8000-000000000020', '00000000-0000-4000-8000-000000000010', 'Zone A', 1000, 'public', 'single_use', 'Zone A'),
  ('00000000-0000-4000-8000-000000000021', '00000000-0000-4000-8000-000000000010', 'Zone B', 1000, 'public', 'single_use', 'Zone B'),
  ('00000000-0000-4000-8000-000000000022', '00000000-0000-4000-8000-000000000010', 'No Zone', 1000, 'public', 'single_use', NULL),
  ('00000000-0000-4000-8000-000000000023', '00000000-0000-4000-8000-000000000010', 'Staff', 0, 'staff', 'multi_scan', NULL),
  ('00000000-0000-4000-8000-000000000024', '00000000-0000-4000-8000-000000000011', 'Other event', 1000, 'public', 'single_use', NULL);

INSERT INTO ticketing.tickets (id, event_id, ticket_type_id, origin, code_human, status) VALUES
  ('00000000-0000-4000-8000-000000000040', '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000020', 'courtesy', 'C0DE400000', 'issued'),
  ('00000000-0000-4000-8000-000000000041', '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000021', 'courtesy', 'C0DE410000', 'issued'),
  ('00000000-0000-4000-8000-000000000042', '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000022', 'courtesy', 'C0DE420000', 'issued'),
  ('00000000-0000-4000-8000-000000000043', '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000023', 'courtesy', 'C0DE430000', 'issued'),
  ('00000000-0000-4000-8000-000000000044', '00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000024', 'courtesy', 'C0DE440000', 'issued'),
  ('00000000-0000-4000-8000-000000000045', '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000022', 'courtesy', 'C0DE450000', 'unsold');

-- Devices of staff member 0b: 30 zone A, 31 without zone, 32 revoked, 33 expired.
-- Device 34 belongs to staff member 0c.
INSERT INTO staff.staff_devices (id, event_id, user_id, role, zone, valid_from, valid_until, revoked_at) VALUES
  ('00000000-0000-4000-8000-000000000030', '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-00000000000b', 'gate', 'Zone A', now() - interval '1 day', now() + interval '1 day', NULL),
  ('00000000-0000-4000-8000-000000000031', '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-00000000000b', 'gate', NULL, now() - interval '1 day', now() + interval '1 day', NULL),
  ('00000000-0000-4000-8000-000000000032', '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-00000000000b', 'gate', NULL, now() - interval '1 day', now() + interval '1 day', now()),
  ('00000000-0000-4000-8000-000000000033', '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-00000000000b', 'gate', NULL, now() - interval '2 days', now() - interval '1 day', NULL),
  ('00000000-0000-4000-8000-000000000034', '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-00000000000c', 'gate', NULL, now() - interval '1 day', now() + interval '1 day', NULL);

-- An admitted scan of a single-use ticket (42) and of a multi-scan one (43).
INSERT INTO redemption.redemptions (id, ticket_id, device_id, device_seq, scanned_at_device, method, entry_mode, outcome) VALUES
  ('00000000-0000-4000-8000-000000000050', '00000000-0000-4000-8000-000000000042', '00000000-0000-4000-8000-000000000031', 1, now(), 'qr', 'single_use', 'admitted'),
  ('00000000-0000-4000-8000-000000000051', '00000000-0000-4000-8000-000000000043', '00000000-0000-4000-8000-000000000031', 2, now(), 'qr', 'multi_scan', 'admitted');

-- Ticket 40 bound to a device key.
SELECT identity.set_actor(NULL, 'system');
SELECT ticketing.bind('00000000-0000-4000-8000-000000000040',
  '\xaa00000000000000000000000000000000000000000000000000000000000000', 'bind');

-- ── Who gets a manifest ──────────────────────────────────────────────────────
SET LOCAL SESSION AUTHORIZATION passripple_api;
SELECT identity.set_actor('00000000-0000-4000-8000-00000000000b', 'staff');

SELECT throws_ok($$ SELECT * FROM manifest.gate_event('00000000-0000-4000-8000-000000000034') $$,
  '42501', NULL, 'another staff member''s device gets no manifest');
SELECT throws_ok($$ SELECT * FROM manifest.gate_event('00000000-0000-4000-8000-000000000032') $$,
  '42501', NULL, 'a revoked device gets no manifest');
SELECT throws_ok($$ SELECT * FROM manifest.gate_ticket_types('00000000-0000-4000-8000-000000000033') $$,
  '42501', NULL, 'an expired device gets no manifest');
SELECT throws_ok($$ SELECT * FROM manifest.gate_tickets('00000000-0000-4000-8000-000000000032') $$,
  '42501', NULL, 'a revoked device gets no tickets');

SELECT identity.set_actor('00000000-0000-4000-8000-00000000000d', 'organizer', '00000000-0000-4000-8000-00000000000a');
SELECT throws_ok($$ SELECT * FROM manifest.gate_event('00000000-0000-4000-8000-000000000030') $$,
  '42501', NULL, 'an organizer gets no gate manifest');

-- ── What it holds ────────────────────────────────────────────────────────────
SELECT identity.set_actor('00000000-0000-4000-8000-00000000000b', 'staff');

SELECT row_eq(
  $$ SELECT event_id, age_rating, device_zone FROM manifest.gate_event('00000000-0000-4000-8000-000000000030') $$,
  ROW('00000000-0000-4000-8000-000000000010'::uuid, '18plus'::text, 'Zone A'::text),
  'gate_event returns the device''s event and zone'
);
SELECT results_eq(
  $$ SELECT name FROM manifest.gate_ticket_types('00000000-0000-4000-8000-000000000030') ORDER BY name $$,
  ARRAY['No Zone', 'Staff', 'Zone A'],
  'a zone device gets the types of its zone and those without a zone'
);
SELECT results_eq(
  $$ SELECT name FROM manifest.gate_ticket_types('00000000-0000-4000-8000-000000000031') ORDER BY name $$,
  ARRAY['No Zone', 'Staff', 'Zone A', 'Zone B'],
  'a device without a zone gets every type of its event'
);
SELECT results_eq(
  $$ SELECT ticket_id FROM manifest.gate_tickets('00000000-0000-4000-8000-000000000030') $$,
  ARRAY['00000000-0000-4000-8000-000000000040'::uuid, '00000000-0000-4000-8000-000000000042'::uuid,
        '00000000-0000-4000-8000-000000000043'::uuid],
  'tickets of the zone and without a zone; no other zone, no other event, no unsold ticket'
);

SELECT is(
  (SELECT redeemed FROM manifest.gate_tickets('00000000-0000-4000-8000-000000000031')
    WHERE ticket_id = '00000000-0000-4000-8000-000000000042'),
  true, 'an admitted single-use ticket is redeemed'
);
SELECT is(
  (SELECT redeemed FROM manifest.gate_tickets('00000000-0000-4000-8000-000000000031')
    WHERE ticket_id = '00000000-0000-4000-8000-000000000043'),
  false, 'a multi-scan ticket is never marked redeemed'
);
SELECT row_eq(
  $$ SELECT status, redeemed, holder_pubkey, key_version, code_human FROM manifest.gate_tickets('00000000-0000-4000-8000-000000000031')
      WHERE ticket_id = '00000000-0000-4000-8000-000000000040' $$,
  ROW('bound'::text, false, '\xaa00000000000000000000000000000000000000000000000000000000000000'::bytea, 1::smallint, 'C0DE400000'::text),
  'a bound ticket carries its holder''s public key and key version'
);

-- Nothing longer than a public key leaves in the manifest (I7).
SELECT is(
  (SELECT max(length(holder_pubkey)) FROM manifest.gate_tickets('00000000-0000-4000-8000-000000000031')),
  32, 'no key material longer than a 32-byte public key'
);

RESET SESSION AUTHORIZATION;

-- ── Incremental updates across transactions (dblink) ─────────────────────────
-- A device keeps manifest.cursor() and passes it back as since. Changes committed after it
-- must come back; so must a change still in flight when the cursor was taken.
CREATE FUNCTION pg_temp.cleanup_mf() RETURNS text LANGUAGE sql AS $f$
  SELECT dblink_exec('setup', $c$
    SET session_replication_role = replica;
    DELETE FROM redemption.redemptions WHERE device_id = '00000000-0000-4000-8000-0000000c7030';
    DELETE FROM ticketing.ticket_bindings WHERE ticket_id IN
      (SELECT id FROM ticketing.tickets WHERE event_id = '00000000-0000-4000-8000-0000000c7010');
    DELETE FROM ticketing.tickets WHERE event_id = '00000000-0000-4000-8000-0000000c7010';
    DELETE FROM staff.staff_devices WHERE event_id = '00000000-0000-4000-8000-0000000c7010';
    DELETE FROM catalog.ticket_types WHERE event_id = '00000000-0000-4000-8000-0000000c7010';
    DELETE FROM events.events WHERE id = '00000000-0000-4000-8000-0000000c7010';
    DELETE FROM identity.users WHERE id = '00000000-0000-4000-8000-0000000c700b';
    DELETE FROM identity.organizations WHERE id = '00000000-0000-4000-8000-0000000c700a';
    DELETE FROM jurisdictions.jurisdictions WHERE canton_code = 'CONC-MF';
    RESET session_replication_role;
  $c$);
$f$;

-- Opens a transaction on b acting as the staff member, through the API.
CREATE FUNCTION pg_temp.b_begin() RETURNS text LANGUAGE sql AS $f$
  SELECT dblink_exec('b', 'BEGIN') || dblink_exec('b', 'SET LOCAL SESSION AUTHORIZATION passripple_api')
         || (SELECT x FROM dblink('b', $q$SELECT identity.set_actor('00000000-0000-4000-8000-0000000c700b', 'staff')::text$q$) AS t(x text));
$f$;
-- The tickets b gets since a cursor, as a sorted list of ticket codes.
CREATE FUNCTION pg_temp.b_delta(p_since text) RETURNS text LANGUAGE sql AS $f$
  SELECT x FROM dblink('b', format(
    $q$SELECT coalesce(string_agg(code_human, ',' ORDER BY code_human), '')
         FROM manifest.gate_tickets('00000000-0000-4000-8000-0000000c7030', %L::xid8)$q$, p_since)) AS t(x text);
$f$;

SELECT dblink_connect(name, format('dbname=%s user=%s', current_database(),
                                   (SELECT rolname FROM pg_roles WHERE oid = 10)))
  FROM unnest(ARRAY['setup', 'a', 'b']) AS name;
SELECT pg_temp.cleanup_mf();
SELECT dblink_exec('setup', $$
  INSERT INTO jurisdictions.jurisdictions (canton_code, name, tax_rate_bps, courtesy_deduct_bps, settlement_rule)
  VALUES ('CONC-MF', 'Manifest', 0, '{}', 'next_business_day');
  INSERT INTO identity.organizations (id, name, verified_at)
  VALUES ('00000000-0000-4000-8000-0000000c700a', 'Manifest org', now());
  INSERT INTO identity.users (id, is_admin) VALUES ('00000000-0000-4000-8000-0000000c700b', false);
  INSERT INTO events.events (id, org_id, canton_code, name, venue_name, starts_at, age_rating,
                             permitted_capacity, status, published_at)
  VALUES ('00000000-0000-4000-8000-0000000c7010', '00000000-0000-4000-8000-0000000c700a', 'CONC-MF',
          'Delta', 'Venue', now(), 'all', 10, 'on_sale', now());
  INSERT INTO catalog.ticket_types (id, event_id, name, price_crc, audience)
  VALUES ('00000000-0000-4000-8000-0000000c7020', '00000000-0000-4000-8000-0000000c7010', 'Public', 1000, 'public');
  INSERT INTO ticketing.tickets (id, event_id, ticket_type_id, origin, code_human, status) VALUES
    ('00000000-0000-4000-8000-0000000c7041', '00000000-0000-4000-8000-0000000c7010', '00000000-0000-4000-8000-0000000c7020', 'courtesy', 'D000000001', 'issued'),
    ('00000000-0000-4000-8000-0000000c7042', '00000000-0000-4000-8000-0000000c7010', '00000000-0000-4000-8000-0000000c7020', 'courtesy', 'D000000002', 'issued'),
    ('00000000-0000-4000-8000-0000000c7043', '00000000-0000-4000-8000-0000000c7010', '00000000-0000-4000-8000-0000000c7020', 'courtesy', 'D000000003', 'issued'),
    ('00000000-0000-4000-8000-0000000c7044', '00000000-0000-4000-8000-0000000c7010', '00000000-0000-4000-8000-0000000c7020', 'courtesy', 'D000000004', 'issued');
  INSERT INTO staff.staff_devices (id, event_id, user_id, role, valid_from, valid_until)
  VALUES ('00000000-0000-4000-8000-0000000c7030', '00000000-0000-4000-8000-0000000c7010',
          '00000000-0000-4000-8000-0000000c700b', 'gate', now() - interval '1 day', now() + interval '1 day');
$$);

-- The device downloads the full manifest and keeps the cursor.
SELECT pg_temp.b_begin();
SELECT set_config('test.cursor0', (SELECT x FROM dblink('b', 'SELECT manifest.cursor()::text') AS t(x text)), true);
SELECT is(pg_temp.b_delta(NULL), 'D000000001,D000000002,D000000003,D000000004', 'the full manifest has every ticket');
SELECT dblink_exec('b', 'COMMIT');

-- Afterwards: one ticket voided, one bound, one admitted, one new; D000000004 untouched.
SELECT dblink_exec('setup', $$
  UPDATE ticketing.tickets SET status = 'void' WHERE id = '00000000-0000-4000-8000-0000000c7041';
  SELECT identity.set_actor(NULL, 'system');
  SELECT ticketing.bind('00000000-0000-4000-8000-0000000c7042',
    '\xbb00000000000000000000000000000000000000000000000000000000000000', 'bind');
  INSERT INTO redemption.redemptions (id, ticket_id, device_id, device_seq, scanned_at_device, method, entry_mode, outcome)
  VALUES ('00000000-0000-4000-8000-0000000c7050', '00000000-0000-4000-8000-0000000c7043',
          '00000000-0000-4000-8000-0000000c7030', 1, now(), 'qr', 'single_use', 'admitted');
  INSERT INTO ticketing.tickets (id, event_id, ticket_type_id, origin, code_human, status)
  VALUES ('00000000-0000-4000-8000-0000000c7045', '00000000-0000-4000-8000-0000000c7010',
          '00000000-0000-4000-8000-0000000c7020', 'courtesy', 'D000000005', 'issued');
$$);

SELECT pg_temp.b_begin();
-- The cursor is the oldest transaction still running, here this test's own, so tickets
-- written after it may come again (each row replaces the device's copy); what matters is
-- that every change does.
SELECT ok(
  string_to_array(pg_temp.b_delta(current_setting('test.cursor0')), ',')
    @> ARRAY['D000000001', 'D000000002', 'D000000003', 'D000000005'],
  'since the cursor: the voided, bound, admitted and new tickets all come back'
);
SELECT dblink_exec('b', 'COMMIT');

-- A writer still running when the device takes its cursor is not missed.
SELECT dblink_exec('a', 'BEGIN');
SELECT dblink_exec('a', $$
  INSERT INTO ticketing.tickets (id, event_id, ticket_type_id, origin, code_human, status)
  VALUES ('00000000-0000-4000-8000-0000000c7046', '00000000-0000-4000-8000-0000000c7010',
          '00000000-0000-4000-8000-0000000c7020', 'courtesy', 'D000000006', 'issued')
$$);
SELECT pg_temp.b_begin();
SELECT set_config('test.cursor1', (SELECT x FROM dblink('b', 'SELECT manifest.cursor()::text') AS t(x text)), true);
SELECT ok(pg_temp.b_delta(current_setting('test.cursor1')) NOT LIKE '%D000000006%',
  'an uncommitted ticket is not visible yet');
SELECT dblink_exec('a', 'COMMIT');
SELECT ok(pg_temp.b_delta(current_setting('test.cursor1')) LIKE '%D000000006%',
  'once committed, it comes back with the cursor taken while it was in flight');
SELECT dblink_exec('b', 'COMMIT');

SELECT pg_temp.cleanup_mf();
SELECT dblink_disconnect(name) FROM unnest(ARRAY['setup', 'a', 'b']) AS name;

SELECT * FROM finish(true);
ROLLBACK;
