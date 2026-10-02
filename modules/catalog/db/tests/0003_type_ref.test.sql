BEGIN;
SELECT plan(10);

-- ── Superuser setup ──────────────────────────────────────────────────────────
INSERT INTO identity.organizations (id, name, verified_at) VALUES
  ('00000000-0000-4000-8000-00000000000a', 'Org 1', now());
INSERT INTO jurisdictions.jurisdictions (canton_code, name, tax_rate_bps, courtesy_deduct_bps, settlement_rule) VALUES
  ('TEST-01', 'Test', 0, '{}', 'next_business_day');
INSERT INTO events.events (id, org_id, canton_code, name, venue_name, starts_at, age_rating, permitted_capacity, status, published_at) VALUES
  ('00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-00000000000a', 'TEST-01', 'Event 1', 'Venue', now(), 'all', 10, 'on_sale', now()),
  ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-00000000000a', 'TEST-01', 'Event 2', 'Venue', now(), 'all', 10, 'on_sale', now());

-- ref is assigned automatically, ignoring passed values
INSERT INTO catalog.ticket_types (id, event_id, name, price_crc, audience, entry_mode, ref) VALUES
  ('00000000-0000-4000-8000-000000000020', '00000000-0000-4000-8000-000000000010', 'Type 1', 1000, 'public', 'single_use', 999),
  ('00000000-0000-4000-8000-000000000021', '00000000-0000-4000-8000-000000000010', 'Type 2', 1000, 'public', 'single_use', 999),
  ('00000000-0000-4000-8000-000000000022', '00000000-0000-4000-8000-000000000011', 'Type 3', 1000, 'public', 'single_use', 999);

SELECT is((SELECT ref FROM catalog.ticket_types WHERE id = '00000000-0000-4000-8000-000000000020'), 1, 'ref 1 for event 1');
SELECT is((SELECT ref FROM catalog.ticket_types WHERE id = '00000000-0000-4000-8000-000000000021'), 2, 'ref 2 for event 1');
SELECT is((SELECT ref FROM catalog.ticket_types WHERE id = '00000000-0000-4000-8000-000000000022'), 1, 'ref 1 for event 2 (independent)');

-- API tests
SET LOCAL SESSION AUTHORIZATION passripple_api;
SELECT throws_ok(
  $$ INSERT INTO catalog.ticket_types (id, event_id, name, price_crc, audience, ref) VALUES ('00000000-0000-4000-8000-000000000023', '00000000-0000-4000-8000-000000000010', 'Type 4', 1000, 'public', 3) $$,
  '42501', NULL, 'api cannot insert ticket_types'
);

-- Owner tests
RESET SESSION AUTHORIZATION;
SET LOCAL ROLE passripple_owner_catalog;

-- Cannot change ref
SELECT throws_ok(
  $$ UPDATE catalog.ticket_types SET ref = 3 WHERE id = '00000000-0000-4000-8000-000000000020' $$,
  '23001', 'ticket type 00000000-0000-4000-8000-000000000020: its event and number never change', 'cannot change ref'
);

-- Cannot change event_id
SELECT throws_ok(
  $$ UPDATE catalog.ticket_types SET event_id = '00000000-0000-4000-8000-000000000011' WHERE id = '00000000-0000-4000-8000-000000000020' $$,
  '23001', 'ticket type 00000000-0000-4000-8000-000000000020: its event and number never change', 'cannot change event_id'
);

-- Allow updates to other fields
SELECT lives_ok(
  $$ UPDATE catalog.ticket_types SET name = 'Updated' WHERE id = '00000000-0000-4000-8000-000000000020' $$,
  'can update other fields'
);

-- Concurrent inserts (using dblink)
RESET SESSION AUTHORIZATION;
CREATE FUNCTION pg_temp.cleanup_i1() RETURNS text LANGUAGE sql AS $f$
  SELECT dblink_exec('setup', $c$
    SET session_replication_role = replica;
    DELETE FROM catalog.ticket_types WHERE event_id = '00000000-0000-4000-8000-0000000c1010';
    DELETE FROM events.events WHERE id = '00000000-0000-4000-8000-0000000c1010';
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
  INSERT INTO events.events (id, org_id, canton_code, name, venue_name, starts_at, age_rating,
                             permitted_capacity, status, published_at, permit_number)
  VALUES ('00000000-0000-4000-8000-0000000c1010', '00000000-0000-4000-8000-0000000c100a', 'CONC-I1',
          'Two types', 'Venue', now(), 'all', 10, 'on_sale', now(), 'P1');
$$);

SELECT dblink_exec(name, 'BEGIN') FROM unnest(ARRAY['a', 'b']) AS name;
-- Both insert a type in parallel
SELECT dblink_send_query('a', $$INSERT INTO catalog.ticket_types (id, event_id, name, price_crc, audience) VALUES ('00000000-0000-4000-8000-0000000c1020', '00000000-0000-4000-8000-0000000c1010', 'Type A', 1000, 'public')$$);
-- Wait a tiny bit so 'a' holds the advisory lock
SELECT pg_sleep(0.1);
SELECT dblink_send_query('b', $$INSERT INTO catalog.ticket_types (id, event_id, name, price_crc, audience) VALUES ('00000000-0000-4000-8000-0000000c1021', '00000000-0000-4000-8000-0000000c1010', 'Type B', 1000, 'public')$$);
SELECT pg_sleep(0.1);

SELECT is(dblink_is_busy('b'), 1, 'the second insert waits for the first');
-- Since a hasn't committed, b should be waiting
SELECT dblink_get_result('a');
SELECT dblink_get_result('a'); -- call again to clear buffer
SELECT dblink_exec('a', 'COMMIT');
SELECT dblink_get_result('b');
SELECT dblink_get_result('b'); -- call again to clear buffer
SELECT dblink_exec('b', 'COMMIT');

-- The second transaction successfully gets the next sequence number!
SELECT is(
  (SELECT count(DISTINCT ref)::int FROM catalog.ticket_types WHERE event_id = '00000000-0000-4000-8000-0000000c1010'),
  2,
  'both types get different refs due to advisory lock'
);

SELECT pg_temp.cleanup_i1();
SELECT dblink_disconnect(name) FROM unnest(ARRAY['setup', 'a', 'b']) AS name;

-- UNIQUE (event_id, ref)
-- Since trigger forces ref to max(ref)+1, we must bypass trigger to test unique index
ALTER TABLE catalog.ticket_types DISABLE TRIGGER ticket_types_assign_ref;
SELECT throws_ok(
  $$ INSERT INTO catalog.ticket_types (id, event_id, name, price_crc, audience, entry_mode, ref) VALUES ('00000000-0000-4000-8000-000000000024', '00000000-0000-4000-8000-000000000010', 'Type 5', 1000, 'public', 'single_use', 1) $$,
  '23505', NULL, 'UNIQUE constraint works'
);
ALTER TABLE catalog.ticket_types ENABLE TRIGGER ticket_types_assign_ref;

SELECT * FROM finish(true);
ROLLBACK;
