BEGIN;
SELECT plan(22);

-- ── Superuser setup ──────────────────────────────────────────────────────────
INSERT INTO identity.organizations (id, name, verified_at) VALUES
  ('00000000-0000-4000-8000-00000000000a', 'Org', now());

INSERT INTO jurisdictions.jurisdictions (canton_code, name, tax_rate_bps, courtesy_deduct_bps, settlement_rule) VALUES
  ('TEST-01', 'Test', 0, '{}', 'next_business_day');

-- Event 1: on sale, capacity 10
INSERT INTO events.events (id, org_id, canton_code, name, venue_name, starts_at, age_rating, permitted_capacity, status, published_at, permit_number) VALUES
  ('00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-00000000000a', 'TEST-01', 'Event 1', 'Venue', now(), 'all', 10, 'on_sale', now(), 'P1');
-- Event 2: draft
INSERT INTO events.events (id, org_id, canton_code, name, venue_name, starts_at, age_rating, permitted_capacity, status) VALUES
  ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-00000000000a', 'TEST-01', 'Event 2', 'Venue', now(), 'all', 10, 'draft');

INSERT INTO catalog.ticket_types (id, event_id, name, price_crc, audience) VALUES
  ('00000000-0000-4000-8000-000000000020', '00000000-0000-4000-8000-000000000010', 'Public 1', 1000, 'public'),
  ('00000000-0000-4000-8000-000000000021', '00000000-0000-4000-8000-000000000010', 'Staff 1', 0, 'staff'),
  ('00000000-0000-4000-8000-000000000022', '00000000-0000-4000-8000-000000000011', 'Public 2', 1000, 'public');

-- Init capacities (would be done by event.published in real flow, but test needs them)
INSERT INTO inventory.event_capacity (event_id, permitted_capacity) VALUES
  ('00000000-0000-4000-8000-000000000010', 10),
  ('00000000-0000-4000-8000-000000000011', 10);

-- ── API actions ──────────────────────────────────────────────────────────────
SET LOCAL SESSION AUTHORIZATION passripple_api;

SELECT throws_ok(
  $$ INSERT INTO inventory.holds (event_id, ticket_type_id, quantity, expires_at) VALUES ('00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000020', 1, now()) $$,
  '42501', NULL, 'API cannot insert holds directly'
);
SELECT throws_ok(
  $$ UPDATE inventory.event_capacity SET permitted_capacity = 20 WHERE event_id = '00000000-0000-4000-8000-000000000010' $$,
  '42501', NULL, 'API cannot update capacity directly'
);
SELECT throws_ok(
  $$ DELETE FROM inventory.event_capacity $$,
  '42501', NULL, 'API cannot delete capacity'
);

SELECT identity.set_actor(NULL, 'buyer');

SELECT is(
  (SELECT inventory.hold('00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000020', 11)),
  NULL,
  'hold exceeding capacity by 1 returns NULL'
);

SELECT throws_ok(
  $$ SELECT inventory.hold('00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000020', 0) $$,
  '22023', NULL, 'hold with quantity 0 fails'
);

SELECT throws_ok(
  $$ SELECT inventory.hold('00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000020', -1) $$,
  '22023', NULL, 'hold with negative quantity fails'
);

SELECT is(
  (SELECT inventory.hold('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000022', 1)),
  NULL,
  'hold for event not on sale returns NULL'
);

SELECT throws_ok(
  $$ SELECT inventory.hold('00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000022', 1) $$,
  '22023', NULL, 'hold for ticket type of another event fails'
);

SELECT throws_ok(
  $$ SELECT inventory.hold('00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000021', 1) $$,
  '22023', NULL, 'hold for non-public ticket type fails'
);

-- Successful hold
SELECT is(
  (SELECT inventory.hold('00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000020', 5) IS NOT NULL),
  true,
  'hold within capacity succeeds'
);

RESET SESSION AUTHORIZATION;
SET LOCAL ROLE passripple_owner_inventory;
DO $$
DECLARE h uuid;
BEGIN
  SELECT id INTO h FROM inventory.holds WHERE event_id = '00000000-0000-4000-8000-000000000010' LIMIT 1;
  PERFORM set_config('app.test_hold', h::text, true);
END $$;
SET LOCAL SESSION AUTHORIZATION passripple_api;
SELECT identity.set_actor(NULL, 'buyer');

-- Release twice
SELECT is((SELECT inventory.release_hold(current_setting('app.test_hold')::uuid)), true, 'first release returns true');
SELECT is((SELECT inventory.release_hold(current_setting('app.test_hold')::uuid)), false, 'second release returns false');

-- System tests
SELECT identity.set_actor(NULL, 'system');

-- Create a hold to expire
DO $$
DECLARE h uuid;
BEGIN
  h := inventory.hold('00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000020', 1);
  PERFORM set_config('app.test_h_exp', h::text, true);
END $$;

-- Expire it by running expiry an hour ahead: only this hold is still active.
SELECT is((SELECT inventory.expire_holds(now() + interval '1 hour')), 1, 'expire_holds expires 1 hold');
SELECT is((SELECT inventory.expire_holds(now() + interval '1 hour')), 0, 'expire_holds twice does nothing');

-- Event updated under committed
DO $$
DECLARE h uuid;
BEGIN
  h := inventory.hold('00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000020', 5);
END $$;

RESET SESSION AUTHORIZATION;
UPDATE events.events SET permitted_capacity = 4 WHERE id = '00000000-0000-4000-8000-000000000010';
SET LOCAL SESSION AUTHORIZATION passripple_api;
SELECT identity.set_actor(NULL, 'system');

SELECT is(
  (SELECT inventory.apply_event_updated('00000000-0000-4000-8000-000000000010')),
  false,
  'apply_event_updated returns false when permitted < committed'
);
-- Counted as the superuser: incidents are visible only to admins and organizers.
RESET SESSION AUTHORIZATION;
SELECT is(
  (SELECT count(*)::int FROM inventory.capacity_incidents WHERE event_id = '00000000-0000-4000-8000-000000000010'),
  1,
  'capacity incident was created'
);

-- ── Owner actions ────────────────────────────────────────────────────────────
SET LOCAL ROLE passripple_owner_inventory;
SELECT throws_ok(
  $$ UPDATE inventory.event_capacity SET committed = 100 WHERE event_id = '00000000-0000-4000-8000-000000000010' $$,
  '23514', NULL, 'owner cannot set committed > permitted_capacity'
);
SELECT throws_ok(
  $$ UPDATE inventory.event_capacity SET committed = -1 WHERE event_id = '00000000-0000-4000-8000-000000000010' $$,
  '23514', NULL, 'owner cannot set committed < 0'
);
RESET ROLE;

-- ── Concurrency (ADR 0011) ───────────────────────────────────────────────────
-- Two real connections race for the last seat. Both must see the data, so a third
-- connection commits it, with ids and a canton of its own, and removes it at the end.
-- The cleanup runs first too, in case an earlier run stopped halfway.
CREATE FUNCTION pg_temp.cleanup_i2() RETURNS text LANGUAGE sql AS $f$
  SELECT dblink_exec('setup', $c$
    SET session_replication_role = replica;
    DELETE FROM inventory.holds WHERE event_id = '00000000-0000-4000-8000-0000000c2010';
    DELETE FROM inventory.event_capacity WHERE event_id = '00000000-0000-4000-8000-0000000c2010';
    DELETE FROM catalog.ticket_types WHERE event_id = '00000000-0000-4000-8000-0000000c2010';
    DELETE FROM events.events WHERE id = '00000000-0000-4000-8000-0000000c2010';
    DELETE FROM identity.organizations WHERE id = '00000000-0000-4000-8000-0000000c200a';
    DELETE FROM jurisdictions.jurisdictions WHERE canton_code = 'CONC-I2';
    RESET session_replication_role;
  $c$);
$f$;

SELECT dblink_connect(name, format('dbname=%s user=%s', current_database(),
                                   (SELECT rolname FROM pg_roles WHERE oid = 10)))
  FROM unnest(ARRAY['setup', 'a', 'b']) AS name;
SELECT pg_temp.cleanup_i2();
SELECT dblink_exec('setup', $$
  INSERT INTO jurisdictions.jurisdictions (canton_code, name, tax_rate_bps, courtesy_deduct_bps, settlement_rule)
  VALUES ('CONC-I2', 'Concurrency', 0, '{}', 'next_business_day');
  INSERT INTO identity.organizations (id, name, verified_at)
  VALUES ('00000000-0000-4000-8000-0000000c200a', 'Concurrency org', now());
  INSERT INTO events.events (id, org_id, canton_code, name, venue_name, starts_at, age_rating,
                             permitted_capacity, status, published_at, permit_number)
  VALUES ('00000000-0000-4000-8000-0000000c2010', '00000000-0000-4000-8000-0000000c200a', 'CONC-I2',
          'Last seat', 'Venue', now(), 'all', 1, 'on_sale', now(), 'P1');
  INSERT INTO catalog.ticket_types (id, event_id, name, price_crc, audience)
  VALUES ('00000000-0000-4000-8000-0000000c2020', '00000000-0000-4000-8000-0000000c2010', 'Public', 1000, 'public');
  INSERT INTO inventory.event_capacity (event_id, permitted_capacity)
  VALUES ('00000000-0000-4000-8000-0000000c2010', 1);
$$);

-- Both racers act as the API, as buyers.
SELECT dblink_exec(name, 'BEGIN'), dblink_exec(name, 'SET LOCAL SESSION AUTHORIZATION passripple_api'),
       (SELECT x FROM dblink(name, $$SELECT identity.set_actor(NULL, 'buyer')::text$$) AS t(x text))
  FROM unnest(ARRAY['a', 'b']) AS name;

-- A takes the last seat and keeps its transaction open, holding the counter's row lock.
SELECT isnt(
  (SELECT h FROM dblink('a', $$SELECT inventory.hold('00000000-0000-4000-8000-0000000c2010',
     '00000000-0000-4000-8000-0000000c2020', 1)::text$$) AS t(h text)),
  NULL,
  'the first connection takes the last seat'
);
SELECT dblink_send_query('b', $$SELECT inventory.hold('00000000-0000-4000-8000-0000000c2010',
  '00000000-0000-4000-8000-0000000c2020', 1)::text$$);
SELECT pg_sleep(0.3);
SELECT is(dblink_is_busy('b'), 1, 'the second hold waits for the first one''s row lock');
SELECT dblink_exec('a', 'COMMIT');
SELECT is(
  (SELECT h FROM dblink_get_result('b') AS t(h text)),
  NULL,
  'once the first commits, the second finds no capacity left'
);
SELECT * FROM dblink_get_result('b') AS t(h text);
SELECT dblink_exec('b', 'COMMIT');
SELECT is(
  (SELECT committed FROM inventory.event_capacity WHERE event_id = '00000000-0000-4000-8000-0000000c2010'),
  1,
  'exactly one seat is committed'
);

SELECT pg_temp.cleanup_i2();
SELECT dblink_disconnect(name) FROM unnest(ARRAY['setup', 'a', 'b']) AS name;

SELECT * FROM finish(true);
ROLLBACK;
