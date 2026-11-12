BEGIN;
SELECT plan(5);

-- ── Superuser setup ──────────────────────────────────────────────────────────
INSERT INTO identity.organizations (id, name, verified_at) VALUES
  ('00000000-0000-4000-8000-00000000000a', 'Org 1', now());
INSERT INTO jurisdictions.jurisdictions (canton_code, name, tax_rate_bps, courtesy_deduct_bps, settlement_rule) VALUES
  ('TEST-01', 'Test', 0, '{}', 'next_business_day');
INSERT INTO events.events (id, org_id, canton_code, name, venue_name, starts_at, age_rating, permitted_capacity, status, published_at) VALUES
  ('00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-00000000000a', 'TEST-01', 'Event 1', 'Venue', now(), 'all', 10, 'on_sale', now());
INSERT INTO catalog.ticket_types (id, event_id, name, price_crc, audience, entry_mode) VALUES
  ('00000000-0000-4000-8000-000000000020', '00000000-0000-4000-8000-000000000010', 'Public 1', 1000, 'public', 'single_use');

-- change_xid se fija al insertar y al actualizar, aunque quien llama pase otro valor
INSERT INTO ticketing.tickets (id, event_id, ticket_type_id, origin, code_human, change_xid) VALUES
  ('00000000-0000-4000-8000-000000000040', '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000020', 'courtesy', 'C0DE400000', '1'::xid8);

SELECT is(
  (SELECT change_xid FROM ticketing.tickets WHERE id = '00000000-0000-4000-8000-000000000040'),
  pg_current_xact_id(),
  'change_xid is stamped with the inserting transaction, whatever the caller passes'
);

UPDATE ticketing.tickets SET status = 'issued', change_xid = '2'::xid8
 WHERE id = '00000000-0000-4000-8000-000000000040';
SELECT is(
  (SELECT change_xid FROM ticketing.tickets WHERE id = '00000000-0000-4000-8000-000000000040'),
  pg_current_xact_id(),
  'change_xid is stamped with the updating transaction, whatever the caller passes'
);

-- ── Across transactions (dblink) ─────────────────────────────────────────────
-- A change in a later transaction moves change_xid forward, so a manifest cursor taken
-- before it asks for the ticket again. The setup connection commits its own rows and
-- removes them at the end; the cleanup runs first too, in case an earlier run stopped.
CREATE FUNCTION pg_temp.cleanup_ct() RETURNS text LANGUAGE sql AS $f$
  SELECT dblink_exec('setup', $c$
    SET session_replication_role = replica;
    DELETE FROM ticketing.tickets WHERE event_id = '00000000-0000-4000-8000-0000000c4010';
    DELETE FROM catalog.ticket_types WHERE event_id = '00000000-0000-4000-8000-0000000c4010';
    DELETE FROM events.events WHERE id = '00000000-0000-4000-8000-0000000c4010';
    DELETE FROM identity.memberships WHERE org_id = '00000000-0000-4000-8000-0000000c400a';
    DELETE FROM identity.users WHERE id = '00000000-0000-4000-8000-0000000c400b';
    DELETE FROM identity.organizations WHERE id = '00000000-0000-4000-8000-0000000c400a';
    DELETE FROM jurisdictions.jurisdictions WHERE canton_code = 'CONC-CT';
    RESET session_replication_role;
  $c$);
$f$;

SELECT dblink_connect(name, format('dbname=%s user=%s', current_database(),
                                   (SELECT rolname FROM pg_roles WHERE oid = 10)))
  FROM unnest(ARRAY['setup', 'a']) AS name;
SELECT pg_temp.cleanup_ct();
SELECT dblink_exec('setup', $$
  INSERT INTO jurisdictions.jurisdictions (canton_code, name, tax_rate_bps, courtesy_deduct_bps, settlement_rule)
  VALUES ('CONC-CT', 'Change tracking', 0, '{}', 'next_business_day');
  INSERT INTO identity.organizations (id, name, verified_at)
  VALUES ('00000000-0000-4000-8000-0000000c400a', 'Change tracking org', now());
  INSERT INTO identity.users (id, is_admin) VALUES ('00000000-0000-4000-8000-0000000c400b', false);
  INSERT INTO identity.memberships (org_id, user_id)
  VALUES ('00000000-0000-4000-8000-0000000c400a', '00000000-0000-4000-8000-0000000c400b');
  INSERT INTO events.events (id, org_id, canton_code, name, venue_name, starts_at, age_rating,
                             permitted_capacity, status, published_at)
  VALUES ('00000000-0000-4000-8000-0000000c4010', '00000000-0000-4000-8000-0000000c400a', 'CONC-CT',
          'Tracked', 'Venue', now(), 'all', 10, 'on_sale', now());
  INSERT INTO catalog.ticket_types (id, event_id, name, price_crc, audience)
  VALUES ('00000000-0000-4000-8000-0000000c4020', '00000000-0000-4000-8000-0000000c4010', 'Public', 1000, 'public');
  INSERT INTO ticketing.tickets (id, event_id, ticket_type_id, origin, code_human, status)
  VALUES ('00000000-0000-4000-8000-0000000c4040', '00000000-0000-4000-8000-0000000c4010',
          '00000000-0000-4000-8000-0000000c4020', 'courtesy', 'C0DEC40400', 'issued');
$$);

SELECT set_config('test.before', (SELECT x FROM dblink('setup', $$
  SELECT change_xid::text FROM ticketing.tickets WHERE id = '00000000-0000-4000-8000-0000000c4040'
$$) AS t(x text)), true);

-- The organizer voids the ticket in a transaction of its own, through the API.
SELECT dblink_exec('a', 'BEGIN'), dblink_exec('a', 'SET LOCAL SESSION AUTHORIZATION passripple_api');
SELECT * FROM dblink('a', $$SELECT identity.set_actor('00000000-0000-4000-8000-0000000c400b', 'organizer',
  '00000000-0000-4000-8000-0000000c400a')::text$$) AS t(x text);
SELECT lives_ok(
  $$ SELECT * FROM dblink('a', $q$SELECT ticketing.void('00000000-0000-4000-8000-0000000c4040')::text$q$) AS t(x text) $$,
  'the organizer voids the ticket'
);
SELECT dblink_exec('a', 'COMMIT');

SELECT is(
  (SELECT status FROM ticketing.tickets WHERE id = '00000000-0000-4000-8000-0000000c4040'),
  'void',
  'the void is committed'
);
SELECT cmp_ok(
  (SELECT change_xid FROM ticketing.tickets WHERE id = '00000000-0000-4000-8000-0000000c4040'),
  '>',
  current_setting('test.before')::xid8,
  'voiding in a later transaction moves change_xid forward'
);

SELECT pg_temp.cleanup_ct();
SELECT dblink_disconnect(name) FROM unnest(ARRAY['setup', 'a']) AS name;

SELECT * FROM finish(true);
ROLLBACK;
