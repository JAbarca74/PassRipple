BEGIN;
SELECT plan(15);

-- ── Superuser setup ──────────────────────────────────────────────────────────
INSERT INTO identity.organizations (id, name, verified_at) VALUES
  ('00000000-0000-4000-8000-00000000000a', 'Org 1', now());
INSERT INTO jurisdictions.jurisdictions (canton_code, name, tax_rate_bps, courtesy_deduct_bps, settlement_rule) VALUES
  ('TEST-01', 'Test', 0, '{}', 'next_business_day');
INSERT INTO events.events (id, org_id, canton_code, name, venue_name, starts_at, age_rating, permitted_capacity, status, published_at) VALUES
  ('00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-00000000000a', 'TEST-01', 'Event 1', 'Venue', now(), 'all', 10, 'on_sale', now());
INSERT INTO catalog.ticket_types (id, event_id, name, price_crc, audience) VALUES
  ('00000000-0000-4000-8000-000000000020', '00000000-0000-4000-8000-000000000010', 'Public 1', 1000, 'public');
INSERT INTO inventory.event_capacity (event_id, permitted_capacity, committed) VALUES
  ('00000000-0000-4000-8000-000000000010', 10, 3);
INSERT INTO inventory.holds (id, event_id, ticket_type_id, quantity, expires_at) VALUES
  ('00000000-0000-4000-8000-000000000030', '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000020', 1, now() + interval '10 min'),
  ('00000000-0000-4000-8000-000000000031', '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000020', 1, now() + interval '10 min'),
  ('00000000-0000-4000-8000-000000000032', '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000020', 1, now() + interval '10 min');

INSERT INTO orders.orders (id, event_id, hold_id, contact_email, access_token_hash, pay_code, amount_crc, idem_key, expires_at) VALUES
  ('00000000-0000-4000-8000-000000000040', '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000030', 'a@a.com', sha256('1'), 'CODE1', 1000, 'idemkey1', now() + interval '10 min'),
  ('00000000-0000-4000-8000-000000000041', '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000031', 'a@a.com', sha256('2'), 'CODE2', 1000, 'idemkey2', now() + interval '10 min'),
  ('00000000-0000-4000-8000-000000000042', '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000032', 'a@a.com', sha256('3'), 'CODE3', 1000, 'idemkey3', now() + interval '10 min');

-- ── API actions ──────────────────────────────────────────────────────────────
SET LOCAL SESSION AUTHORIZATION passripple_api;
SELECT identity.set_actor(NULL, 'system');

DO $$
DECLARE n uuid;
BEGIN
  n := payments.record_notice('bank1', 'ref1', 1000, 'desc', 'payer', '123', sha256('raw1'));
  PERFORM set_config('app.test_n1', n::text, true);
END $$;

SELECT is(
  (SELECT payments.record_notice('bank1', 'ref1', 1000, 'desc', 'payer', '123', sha256('raw1'))),
  current_setting('app.test_n1')::uuid,
  'recording same notice returns same id'
);

SELECT throws_ok(
  $$ SELECT payments.record_notice('bank1', 'ref1', 2000, 'desc', 'payer', '123', sha256('raw2')) $$,
  '23505', NULL, 'same reference but different amount raises error'
);

-- Confirm N1 to Order 1
SELECT is(
  (SELECT payments.confirm(current_setting('app.test_n1')::uuid, '00000000-0000-4000-8000-000000000040')),
  'paid',
  'confirming a valid notice returns paid'
);

-- Confirm twice
SELECT is(
  (SELECT payments.confirm(current_setting('app.test_n1')::uuid, '00000000-0000-4000-8000-000000000040')),
  'already_confirmed',
  'confirming a notice twice returns already_confirmed'
);

-- Two notices for same order
DO $$
DECLARE n2 uuid;
BEGIN
  n2 := payments.record_notice('bank1', 'ref2', 1000, 'desc', 'payer', '123', sha256('raw2'));
  PERFORM set_config('app.test_n2', n2::text, true);
END $$;
SELECT is(
  (SELECT payments.confirm(current_setting('app.test_n2')::uuid, '00000000-0000-4000-8000-000000000040')),
  'surplus',
  'second notice for same order returns surplus'
);

-- Different amount
DO $$
DECLARE n3 uuid;
BEGIN
  n3 := payments.record_notice('bank1', 'ref3', 500, 'desc', 'payer', '123', sha256('raw3'));
  PERFORM set_config('app.test_n3', n3::text, true);
END $$;
SELECT is(
  (SELECT payments.confirm(current_setting('app.test_n3')::uuid, '00000000-0000-4000-8000-000000000041')),
  'amount_mismatch',
  'amount mismatch returns amount_mismatch'
);

SELECT throws_ok(
  $$ INSERT INTO payments.payments (order_id, notice_id, amount_crc) VALUES ('00000000-0000-4000-8000-000000000041', current_setting('app.test_n3')::uuid, 1000) $$,
  '42501', NULL, 'API cannot DML payments directly'
);
SELECT throws_ok(
  $$ UPDATE payments.payments SET amount_crc = 0 WHERE order_id = '00000000-0000-4000-8000-000000000040' $$,
  '42501', NULL, 'API cannot UPDATE payments'
);

-- Superuser UPDATE tests
RESET SESSION AUTHORIZATION;
SELECT throws_ok(
  $$ UPDATE payments.payments SET amount_crc = 0 WHERE order_id = '00000000-0000-4000-8000-000000000040' $$,
  '23001', NULL, 'owner cannot UPDATE payments'
);
SELECT throws_ok(
  $$ DELETE FROM payments.payments WHERE order_id = '00000000-0000-4000-8000-000000000040' $$,
  '23001', NULL, 'owner cannot DELETE payments'
);
SET LOCAL SESSION AUTHORIZATION passripple_api;

-- ── Concurrency (ADR 0011) ───────────────────────────────────────────────────
-- Two notices for the same order are confirmed at the same time on two real
-- connections. Both must see the data, so a third connection commits it, with ids and
-- a canton of its own, and removes it at the end. The cleanup runs first too, in case
-- an earlier run stopped halfway; it disables triggers because payments is append-only.
RESET SESSION AUTHORIZATION;
CREATE FUNCTION pg_temp.cleanup_i4() RETURNS text LANGUAGE sql AS $f$
  SELECT dblink_exec('setup', $c$
    SET session_replication_role = replica;
    DELETE FROM payments.payments WHERE order_id = '00000000-0000-4000-8000-0000000c4040';
    DELETE FROM payments.bank_notices WHERE source = 'conc_i4';
    DELETE FROM orders.orders WHERE id = '00000000-0000-4000-8000-0000000c4040';
    DELETE FROM inventory.holds WHERE event_id = '00000000-0000-4000-8000-0000000c4010';
    DELETE FROM inventory.event_capacity WHERE event_id = '00000000-0000-4000-8000-0000000c4010';
    DELETE FROM catalog.ticket_types WHERE event_id = '00000000-0000-4000-8000-0000000c4010';
    DELETE FROM events.events WHERE id = '00000000-0000-4000-8000-0000000c4010';
    DELETE FROM identity.organizations WHERE id = '00000000-0000-4000-8000-0000000c400a';
    DELETE FROM jurisdictions.jurisdictions WHERE canton_code = 'CONC-I4';
    RESET session_replication_role;
  $c$);
$f$;

SELECT dblink_connect(name, format('dbname=%s user=%s', current_database(),
                                   (SELECT rolname FROM pg_roles WHERE oid = 10)))
  FROM unnest(ARRAY['setup', 'a', 'b']) AS name;
SELECT pg_temp.cleanup_i4();
SELECT dblink_exec('setup', $$
  INSERT INTO jurisdictions.jurisdictions (canton_code, name, tax_rate_bps, courtesy_deduct_bps, settlement_rule)
  VALUES ('CONC-I4', 'Concurrency', 0, '{}', 'next_business_day');
  INSERT INTO identity.organizations (id, name, verified_at)
  VALUES ('00000000-0000-4000-8000-0000000c400a', 'Concurrency org', now());
  INSERT INTO events.events (id, org_id, canton_code, name, venue_name, starts_at, age_rating,
                             permitted_capacity, status, published_at, permit_number)
  VALUES ('00000000-0000-4000-8000-0000000c4010', '00000000-0000-4000-8000-0000000c400a', 'CONC-I4',
          'Two notices', 'Venue', now(), 'all', 10, 'on_sale', now(), 'P1');
  INSERT INTO catalog.ticket_types (id, event_id, name, price_crc, audience)
  VALUES ('00000000-0000-4000-8000-0000000c4020', '00000000-0000-4000-8000-0000000c4010', 'Public', 1000, 'public');
  INSERT INTO inventory.event_capacity (event_id, permitted_capacity, committed)
  VALUES ('00000000-0000-4000-8000-0000000c4010', 10, 1);
  INSERT INTO inventory.holds (id, event_id, ticket_type_id, quantity, expires_at)
  VALUES ('00000000-0000-4000-8000-0000000c4030', '00000000-0000-4000-8000-0000000c4010',
          '00000000-0000-4000-8000-0000000c4020', 1, now() + interval '30 minutes');
  INSERT INTO orders.orders (id, event_id, hold_id, contact_email, access_token_hash, pay_code,
                             amount_crc, idem_key, expires_at)
  VALUES ('00000000-0000-4000-8000-0000000c4040', '00000000-0000-4000-8000-0000000c4010',
          '00000000-0000-4000-8000-0000000c4030', 'buyer@example.test', sha256('conc-i4'), 'CONCI4',
          1000, 'conc-i4-idem', now() + interval '30 minutes');
  INSERT INTO payments.bank_notices (id, source, reference, amount_crc, raw_sha256) VALUES
    ('00000000-0000-4000-8000-0000000c4051', 'conc_i4', 'REF-A', 1000, sha256('conc-i4-a')),
    ('00000000-0000-4000-8000-0000000c4052', 'conc_i4', 'REF-B', 1000, sha256('conc-i4-b'));
$$);

-- Both racers act as the API, as the system.
SELECT dblink_exec(name, 'BEGIN'), dblink_exec(name, 'SET LOCAL SESSION AUTHORIZATION passripple_api'),
       (SELECT x FROM dblink(name, $$SELECT identity.set_actor(NULL, 'system')::text$$) AS t(x text))
  FROM unnest(ARRAY['a', 'b']) AS name;

-- A confirms the first notice and keeps its transaction open.
SELECT is(
  (SELECT r FROM dblink('a', $$SELECT payments.confirm('00000000-0000-4000-8000-0000000c4051',
     '00000000-0000-4000-8000-0000000c4040')$$) AS t(r text)),
  'paid',
  'the first notice pays the order'
);
SELECT dblink_send_query('b', $$SELECT payments.confirm('00000000-0000-4000-8000-0000000c4052',
  '00000000-0000-4000-8000-0000000c4040')$$);
SELECT pg_sleep(0.3);
SELECT is(dblink_is_busy('b'), 1, 'the second confirmation waits for the first');
SELECT dblink_exec('a', 'COMMIT');
SELECT is(
  (SELECT r FROM dblink_get_result('b') AS t(r text)),
  'surplus',
  'once the first commits, the second notice is surplus, not a second payment'
);
SELECT * FROM dblink_get_result('b') AS t(r text);
SELECT dblink_exec('b', 'COMMIT');
SELECT is(
  (SELECT count(*)::int FROM payments.payments WHERE order_id = '00000000-0000-4000-8000-0000000c4040'),
  1,
  'the order has exactly one payment'
);

SELECT pg_temp.cleanup_i4();
SELECT dblink_disconnect(name) FROM unnest(ARRAY['setup', 'a', 'b']) AS name;

SELECT * FROM finish(true);
ROLLBACK;
