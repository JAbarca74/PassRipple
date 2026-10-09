BEGIN;
SELECT no_plan();

-- Setup
INSERT INTO identity.users (id, email) VALUES 
('00000000-0000-0000-0000-000000000001', 'org@example.com'),
('00000000-0000-0000-0000-000000000002', 'other@example.com'),
('00000000-0000-0000-0000-000000000003', 'staff@example.com');

INSERT INTO identity.organizations (id, name) VALUES 
('00000000-0000-0000-0000-000000000010', 'Org 1'),
('00000000-0000-0000-0000-000000000011', 'Org 2');

INSERT INTO identity.memberships (org_id, user_id) VALUES 
('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000001'),
('00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000002'),
('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000003', 'staff');

INSERT INTO jurisdictions.jurisdictions (canton_code, name, tax_rate_bps, courtesy_deduct_bps, settlement_rule)
VALUES ('TEST-01', 'Test', 0, '{}', 'next_business_day');

INSERT INTO events.events (id, org_id, canton_code, name, venue_name, starts_at, ends_at, age_rating) VALUES ('00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000010', 'TEST-01', 'Event 1', 'V', now(), 'all_ages', now() + interval '1 day'),
('00000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000011', 'TEST-01', 'Event 2', 'V', now(), now() + interval '1 day');

-- create_code
SELECT identity.set_actor('00000000-0000-0000-0000-000000000001', 'organizer');

SELECT lives_ok(
    $$SELECT staff.create_code('00000000-0000-0000-0000-000000000020', 'gate', NULL, now(), now() + interval '1 day', 10, '\x0100000000000000000000000000000000000000000000000000000000000000'::bytea)$$,
    'organizer can create code for their event'
);

SELECT throws_ok(
    $$SELECT staff.create_code('00000000-0000-0000-0000-000000000020', 'gate', NULL, now(), now() + interval '1 day', 10, '\x0100000000000000000000000000000000000000000000000000000000000000'::bytea)$$,
    '23505',
    NULL,
    'code_hash uniqueness'
);

SELECT throws_ok(
    $$SELECT staff.create_code('00000000-0000-0000-0000-000000000020', 'gate', NULL, now(), now() + interval '1 day', 0, '\x0200000000000000000000000000000000000000000000000000000000000000'::bytea)$$,
    '23514',
    NULL,
    'max_uses 0 CHECK'
);
SELECT throws_ok(
    $$SELECT staff.create_code('00000000-0000-0000-0000-000000000020', 'gate', NULL, now(), now() + interval '1 day', 1001, '\x0200000000000000000000000000000000000000000000000000000000000000'::bytea)$$,
    '23514',
    NULL,
    'max_uses 1001 CHECK'
);

-- check other org organizer
SELECT identity.set_actor('00000000-0000-0000-0000-000000000002', 'organizer');
SELECT throws_ok(
    $$SELECT staff.create_code('00000000-0000-0000-0000-000000000020', 'gate', NULL, now(), now() + interval '1 day', 10, '\x0300000000000000000000000000000000000000000000000000000000000000'::bytea)$$,
    '42501',
    NULL,
    'other organizer cannot create code for org 1 event'
);

-- check staff
SELECT identity.set_actor('00000000-0000-0000-0000-000000000003', 'staff');
SELECT throws_ok(
    $$SELECT staff.create_code('00000000-0000-0000-0000-000000000020', 'gate', NULL, now(), now() + interval '1 day', 10, '\x0400000000000000000000000000000000000000000000000000000000000000'::bytea)$$,
    '42501',
    NULL,
    'staff cannot create code'
);

-- revoke_code
SELECT identity.set_actor('00000000-0000-0000-0000-000000000001', 'organizer');
DO $$
DECLARE v_id uuid;
BEGIN
  SELECT id INTO v_id FROM staff.staff_codes WHERE code_hash = '\x0100000000000000000000000000000000000000000000000000000000000000'::bytea;
  PERFORM staff.revoke_code(v_id);
END $$;

SELECT results_eq(
    $$SELECT revoked_at IS NOT NULL FROM staff.staff_codes WHERE code_hash = '\x0100000000000000000000000000000000000000000000000000000000000000'::bytea$$,
    ARRAY[true],
    'organizer can revoke code'
);

-- revocar dos veces conserva la primera fecha
DO $$
DECLARE
  v_id uuid;
  d1 timestamptz;
  d2 timestamptz;
BEGIN
  SELECT id INTO v_id FROM staff.staff_codes WHERE code_hash = '\x0100000000000000000000000000000000000000000000000000000000000000'::bytea;
  SELECT revoked_at INTO d1 FROM staff.staff_codes WHERE id = v_id;
  PERFORM pg_sleep(0.1);
  PERFORM staff.revoke_code(v_id);
  SELECT revoked_at INTO d2 FROM staff.staff_codes WHERE id = v_id;
  IF d1 <> d2 THEN RAISE EXCEPTION 'date changed'; END IF;
END $$;

-- enroll
-- create valid code first
SELECT staff.create_code('00000000-0000-0000-0000-000000000020', 'gate', 'Zone A', now() + interval '1 hour', now() + interval '1 day', 2, '\x0500000000000000000000000000000000000000000000000000000000000000'::bytea);

-- must be staff
SELECT identity.set_actor('00000000-0000-0000-0000-000000000001', 'organizer');
SELECT throws_ok(
    $$SELECT staff.enroll('\x0500000000000000000000000000000000000000000000000000000000000000'::bytea, '\x1000000000000000000000000000000000000000000000000000000000000000'::bytea)$$,
    'P0001',
    NULL,
    'only staff can enroll'
);

SELECT identity.set_actor('00000000-0000-0000-0000-000000000003', 'staff');
-- enrolls even before valid_from
SELECT isnt(
    (SELECT staff.enroll('\x0500000000000000000000000000000000000000000000000000000000000000'::bytea, '\x1100000000000000000000000000000000000000000000000000000000000000'::bytea)),
    NULL,
    'enroll succeeds and returns device_id'
);

SELECT results_eq(
    $$SELECT uses FROM staff.staff_codes WHERE code_hash = '\x0500000000000000000000000000000000000000000000000000000000000000'::bytea$$,
    ARRAY[1],
    'enroll consumes a use'
);

-- Check device_sessions is created with correct data
SELECT results_eq(
    $$SELECT role, zone FROM staff.device_sessions WHERE token_hash = '\x1100000000000000000000000000000000000000000000000000000000000000'::bytea$$,
    ARRAY[('gate'::staff.staff_role, 'Zone A'::text)],
    'copies role and zone'
);

-- exhausted code gives P0002
SELECT staff.enroll('\x0500000000000000000000000000000000000000000000000000000000000000'::bytea, '\x1200000000000000000000000000000000000000000000000000000000000000'::bytea);
SELECT throws_ok(
    $$SELECT staff.enroll('\x0500000000000000000000000000000000000000000000000000000000000000'::bytea, '\x1300000000000000000000000000000000000000000000000000000000000000'::bytea)$$,
    'P0002',
    NULL,
    'exhausted code throws'
);

-- revoked code gives P0002
SELECT throws_ok(
    $$SELECT staff.enroll('\x0100000000000000000000000000000000000000000000000000000000000000'::bytea, '\x1400000000000000000000000000000000000000000000000000000000000000'::bytea)$$,
    'P0002',
    NULL,
    'revoked code throws'
);

-- expired code gives P0002
SELECT identity.set_actor('00000000-0000-0000-0000-000000000001', 'organizer');
SELECT staff.create_code('00000000-0000-0000-0000-000000000020', 'gate', NULL, now() - interval '2 days', now() - interval '1 day', 2, '\x0600000000000000000000000000000000000000000000000000000000000000'::bytea);
SELECT identity.set_actor('00000000-0000-0000-0000-000000000003', 'staff');
SELECT throws_ok(
    $$SELECT staff.enroll('\x0600000000000000000000000000000000000000000000000000000000000000'::bytea, '\x1500000000000000000000000000000000000000000000000000000000000000'::bytea)$$,
    'P0002',
    NULL,
    'expired code throws'
);

-- dblink race
SELECT identity.set_actor('00000000-0000-0000-0000-000000000001', 'organizer');
SELECT staff.create_code('00000000-0000-0000-0000-000000000020', 'gate', NULL, now(), now() + interval '1 day', 1, '\x0700000000000000000000000000000000000000000000000000000000000000'::bytea);

CREATE FUNCTION pg_temp.cleanup_staff() RETURNS text LANGUAGE sql AS $f$
  SELECT dblink_exec('setup', $c$
    SET session_replication_role = replica;
    DELETE FROM staff.device_sessions WHERE token_hash IN ('\x2000000000000000000000000000000000000000000000000000000000000000', '\x2100000000000000000000000000000000000000000000000000000000000000');
    RESET session_replication_role;
  $c$);
$f$;

SELECT dblink_connect(name, format('dbname=%s user=%s', current_database(), (SELECT rolname FROM pg_roles WHERE oid = 10)))
  FROM unnest(ARRAY['setup', 'a', 'b']) AS name;
SELECT pg_temp.cleanup_staff();

SELECT dblink_exec(name, 'BEGIN'), dblink_exec(name, 'SET SESSION AUTHORIZATION passripple_api') FROM unnest(ARRAY['a', 'b']) AS name;
SELECT dblink_exec(name, $$SELECT identity.set_actor('00000000-0000-0000-0000-000000000003', 'staff')$$) FROM unnest(ARRAY['a', 'b']) AS name;

SELECT dblink_send_query('a', $$SELECT staff.enroll('\x0700000000000000000000000000000000000000000000000000000000000000'::bytea, '\x2000000000000000000000000000000000000000000000000000000000000000'::bytea)$$);
SELECT pg_sleep(0.3);
SELECT dblink_send_query('b', $$SELECT staff.enroll('\x0700000000000000000000000000000000000000000000000000000000000000'::bytea, '\x2100000000000000000000000000000000000000000000000000000000000000'::bytea)$$);
SELECT pg_sleep(0.3);

-- one works, one gives P0002 (code not found / exhausted)
-- we just commit both and check count
SELECT dblink_exec('a', 'COMMIT');
SELECT dblink_exec('b', 'COMMIT');

SELECT results_eq(
    $$SELECT uses FROM staff.staff_codes WHERE code_hash = '\x0700000000000000000000000000000000000000000000000000000000000000'::bytea$$,
    ARRAY[1],
    'max_uses never exceeded (uses=1)'
);

SELECT pg_temp.cleanup_staff();
SELECT dblink_disconnect(name) FROM unnest(ARRAY['setup', 'a', 'b']) AS name;

-- authenticate_device
-- device '\x11...' is active
SELECT is(
    (SELECT status FROM staff.authenticate_device('\x1100000000000000000000000000000000000000000000000000000000000000'::bytea)),
    'active'::staff.device_status,
    'authenticate returns active'
);

-- revoked
UPDATE staff.device_sessions SET revoked_at = now() WHERE token_hash = '\x1100000000000000000000000000000000000000000000000000000000000000'::bytea;
SELECT is(
    (SELECT status FROM staff.authenticate_device('\x1100000000000000000000000000000000000000000000000000000000000000'::bytea)),
    'revoked'::staff.device_status,
    'authenticate returns revoked'
);

-- sign_out_device
SELECT identity.set_actor('00000000-0000-0000-0000-000000000003', 'staff');
SELECT lives_ok(
    $$SELECT staff.sign_out_device('\x1200000000000000000000000000000000000000000000000000000000000000'::bytea)$$,
    'staff owner can sign out device'
);
SELECT results_eq(
    $$SELECT ended_at IS NOT NULL AND revoked_at IS NOT NULL FROM staff.device_sessions WHERE token_hash = '\x1200000000000000000000000000000000000000000000000000000000000000'::bytea$$,
    ARRAY[true],
    'sign out ends and revokes session'
);

SELECT throws_ok(
    $$SELECT staff.sign_out_device('\x1200000000000000000000000000000000000000000000000000000000000000'::bytea)$$,
    'P0001',
    NULL,
    'signing out again throws or fails (only owner can sign out and owner check fails if already ended, or is idempotent. Wait, rule says sign out device ends session)'
);

-- RLS passripple_api
RESET SESSION AUTHORIZATION;
SET SESSION AUTHORIZATION passripple_api;
SELECT throws_ok(
    $$SELECT code_hash FROM staff.staff_codes$$,
    '42501',
    NULL,
    'api cannot select code_hash'
);
SELECT throws_ok(
    $$SELECT * FROM staff.device_sessions$$,
    '42501',
    NULL,
    'api cannot select device_sessions'
);

-- un organizador ve los códigos de sus eventos y no los de otra organización.
RESET SESSION AUTHORIZATION;
SELECT identity.set_actor('00000000-0000-0000-0000-000000000001', 'organizer');
SELECT results_eq(
    $$SELECT event_id FROM staff.staff_codes$$,
    ARRAY['00000000-0000-0000-0000-000000000020'::uuid, '00000000-0000-0000-0000-000000000020'::uuid, '00000000-0000-0000-0000-000000000020'::uuid, '00000000-0000-0000-0000-000000000020'::uuid],
    'organizer 1 sees only event 1 codes'
);

SELECT * FROM finish();
ROLLBACK;





