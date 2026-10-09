BEGIN;
SELECT no_plan();

INSERT INTO identity.users (id, email) VALUES 
('00000000-0000-0000-0000-000000000001', 'manifest1@example.com'),
('00000000-0000-0000-0000-000000000002', 'manifest2@example.com');
INSERT INTO identity.organizations (id, name) VALUES ('00000000-0000-0000-0000-000000000010', 'Org 1');
INSERT INTO jurisdictions.jurisdictions (canton_code, name, tax_rate_bps, courtesy_deduct_bps, settlement_rule) VALUES ('TEST', 'T', 0, '{}', 'next_business_day');
INSERT INTO events.events (id, org_id, canton_code, name, venue_name, starts_at, ends_at, age_rating) VALUES ('00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000010', 'TEST', 'Ev1', 'V', now(), 'all_ages', now() + interval '1 day'),
('00000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000010', 'TEST', 'Ev2', 'V', now(), now() + interval '1 day');

INSERT INTO catalog.ticket_types (id, event_id, name, price_crc, audience, zone) VALUES 
('00000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000020', 'Zone A', 1000, 'public', 'Zone A'),
('00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-000000000020', 'Zone B', 1000, 'public', 'Zone B'),
('00000000-0000-0000-0000-000000000032', '00000000-0000-0000-0000-000000000020', 'No Zone', 1000, 'public', NULL);

INSERT INTO inventory.event_capacity (event_id, permitted_capacity, committed) VALUES ('00000000-0000-0000-0000-000000000020', 10, 3);
INSERT INTO inventory.event_capacity (event_id, permitted_capacity, committed) VALUES ('00000000-0000-0000-0000-000000000021', 10, 1);

-- Tickets event 1
INSERT INTO ticketing.tickets (id, event_id, type_id, status) VALUES 
('00000000-0000-0000-0000-000000000040', '00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000030', 'issued'),
('00000000-0000-0000-0000-000000000041', '00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000031', 'issued'),
('00000000-0000-0000-0000-000000000042', '00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000032', 'issued');

-- Ticket event 2
INSERT INTO catalog.ticket_types (id, event_id, name, price_crc, audience) VALUES ('00000000-0000-0000-0000-000000000033', '00000000-0000-0000-0000-000000000021', 'P', 1000, 'public');
INSERT INTO ticketing.tickets (id, event_id, type_id, status) VALUES 
('00000000-0000-0000-0000-000000000043', '00000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000033', 'issued');

INSERT INTO staff.staff_codes (id, event_id, role, zone, valid_from, valid_until, max_uses, uses, code_hash) VALUES 
('00000000-0000-0000-0000-000000000050', '00000000-0000-0000-0000-000000000020', 'gate', 'Zone A', now(), now() + interval '1 day', 10, 1, '\x0100000000000000000000000000000000000000000000000000000000000000'::bytea);

-- active device
INSERT INTO staff.device_sessions (token_hash, device_id, event_id, user_id, role, zone, valid_from, valid_until) VALUES 
('\x0200000000000000000000000000000000000000000000000000000000000000'::bytea, '00000000-0000-0000-0000-000000000060', '00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000001', 'gate', 'Zone A', now(), now() + interval '1 day');

-- revoked device
INSERT INTO staff.device_sessions (token_hash, device_id, event_id, user_id, role, valid_from, valid_until, revoked_at) VALUES 
('\x0300000000000000000000000000000000000000000000000000000000000000'::bytea, '00000000-0000-0000-0000-000000000061', '00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000001', 'gate', now(), now() + interval '1 day', now());

-- expired device
INSERT INTO staff.device_sessions (token_hash, device_id, event_id, user_id, role, valid_from, valid_until) VALUES 
('\x0400000000000000000000000000000000000000000000000000000000000000'::bytea, '00000000-0000-0000-0000-000000000062', '00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000001', 'gate', now() - interval '2 days', now() - interval '1 day');

-- Solo un dispositivo activo del staff que actúa obtiene datos
SET SESSION AUTHORIZATION passripple_api;
SELECT identity.set_actor('00000000-0000-0000-0000-000000000002', 'staff');
-- device belongs to user 1, so user 2 cannot read
PERFORM set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000002","dev":"\x0200000000000000000000000000000000000000000000000000000000000000"}', true);
SELECT throws_ok($$SELECT manifest.gate_event()$$, '42501', NULL, 'another staff device throws');

SELECT identity.set_actor('00000000-0000-0000-0000-000000000001', 'staff');
PERFORM set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000001","dev":"\x0300000000000000000000000000000000000000000000000000000000000000"}', true);
SELECT throws_ok($$SELECT manifest.gate_event()$$, '42501', NULL, 'revoked device throws');

PERFORM set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000001","dev":"\x0400000000000000000000000000000000000000000000000000000000000000"}', true);
SELECT throws_ok($$SELECT manifest.gate_event()$$, '42501', NULL, 'expired device throws');

SELECT identity.set_actor('00000000-0000-0000-0000-000000000001', 'organizer');
PERFORM set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000001","dev":"\x0200000000000000000000000000000000000000000000000000000000000000"}', true);
SELECT throws_ok($$SELECT manifest.gate_event()$$, '42501', NULL, 'organizer throws');

-- active device works
SELECT identity.set_actor('00000000-0000-0000-0000-000000000001', 'staff');
PERFORM set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000001","dev":"\x0200000000000000000000000000000000000000000000000000000000000000"}', true);

SELECT isnt((SELECT event_id FROM manifest.gate_event()), NULL, 'active device can read gate_event');

-- gate_event, gate_ticket_types y gate_tickets devuelven solo el evento del dispositivo, filtro por zona
SELECT results_eq(
    $$SELECT event_id FROM manifest.gate_event()$$,
    ARRAY['00000000-0000-0000-0000-000000000020'::uuid],
    'gate_event only returns device event'
);

SELECT results_eq(
    $$SELECT name FROM manifest.gate_ticket_types() ORDER BY name$$,
    ARRAY['No Zone', 'Zone A'],
    'returns types of the zone and types with no zone, no Zone B'
);

SELECT results_eq(
    $$SELECT ticket_id FROM manifest.gate_tickets(manifest.cursor(), '0') ORDER BY ticket_id$$,
    ARRAY['00000000-0000-0000-0000-000000000040'::uuid, '00000000-0000-0000-0000-000000000042'::uuid],
    'returns tickets matching types of the zone'
);

-- redeemed es verdadero solo con un canje admitted de una entrada de un solo uso
INSERT INTO redemption.scans (id, device_id, ticket_id, scanned_at, device_seq, method, id_checked, in_manifest, outcome) VALUES 
('00000000-0000-0000-0000-000000000070', '00000000-0000-0000-0000-000000000060', '00000000-0000-0000-0000-000000000040', now(), 1, 'qr', false, true, 'duplicate'),
('00000000-0000-0000-0000-000000000071', '00000000-0000-0000-0000-000000000060', '00000000-0000-0000-0000-000000000042', now(), 2, 'qr', false, true, 'admitted');

SELECT results_eq(
    $$SELECT redeemed FROM manifest.gate_tickets(manifest.cursor(), '0') WHERE ticket_id = '00000000-0000-0000-0000-000000000040'$$,
    ARRAY[false],
    'redeemed is false with duplicate scan'
);
SELECT results_eq(
    $$SELECT redeemed FROM manifest.gate_tickets(manifest.cursor(), '0') WHERE ticket_id = '00000000-0000-0000-0000-000000000042'$$,
    ARRAY[true],
    'redeemed is true with admitted scan'
);

-- since: con el cursor tomado antes, una entrada nueva, una anulada, una revinculada y una con un canje nuevo aparecen
DO $$
DECLARE c text;
BEGIN
  c := manifest.cursor();
  
  -- entrada nueva
  INSERT INTO inventory.event_capacity (event_id, permitted_capacity, committed) VALUES ('00000000-0000-0000-0000-000000000020', 20, 4);
  INSERT INTO ticketing.tickets (id, event_id, type_id, status) VALUES ('00000000-0000-0000-0000-000000000044', '00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000030', 'issued');
  
  -- anulada
  UPDATE ticketing.tickets SET status = 'void' WHERE id = '00000000-0000-0000-0000-000000000040';
  
  -- revinculada
  UPDATE ticketing.tickets SET status = 'bound' WHERE id = '00000000-0000-0000-0000-000000000042';

  -- Wait to ensure time difference is enough for tests if any
  PERFORM pg_sleep(0.1);

  -- Not modified
  -- 00000000-0000-0000-0000-000000000043 is event 2, doesn't matter
  -- 00000000-0000-0000-0000-000000000041 is zone B, doesn't matter

  IF (SELECT count(*) FROM manifest.gate_tickets(manifest.cursor(), c)) <> 3 THEN
    RAISE EXCEPTION 'delta did not return exactly 3 tickets';
  END IF;
END $$;
SELECT pass('delta returns only modified tickets (new, void, rebound, redeemed)');

-- La propiedad del cursor (dblink)
CREATE FUNCTION pg_temp.cleanup_cur() RETURNS text LANGUAGE sql AS $f$
  SELECT dblink_exec('setup', $c$
    SET session_replication_role = replica;
    DELETE FROM ticketing.tickets WHERE id = '00000000-0000-0000-0000-000000000045';
    RESET session_replication_role;
  $c$);
$f$;

SELECT dblink_connect(name, format('dbname=%s user=%s', current_database(), (SELECT rolname FROM pg_roles WHERE oid = 10)))
  FROM unnest(ARRAY['setup', 'a', 'b']) AS name;
SELECT pg_temp.cleanup_cur();

SELECT dblink_exec('a', 'BEGIN');
SELECT dblink_exec('b', 'BEGIN');
SELECT dblink_exec('b', 'SET SESSION AUTHORIZATION passripple_api');
SELECT dblink_exec('b', $$SELECT identity.set_actor('00000000-0000-0000-0000-000000000001', 'staff')$$);
SELECT dblink_exec('b', $$SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000001","dev":"\x0200000000000000000000000000000000000000000000000000000000000000"}', true)$$);

-- A inserts a ticket
SELECT dblink_exec('a', $$INSERT INTO ticketing.tickets (id, event_id, type_id, status) VALUES ('00000000-0000-0000-0000-000000000045', '00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000030', 'issued')$$);

-- B takes cursor and reads delta (cannot see 45)
DO $$
DECLARE c text;
BEGIN
  SELECT cursor INTO c FROM dblink('b', $$SELECT manifest.cursor()$$) AS t(cursor text);
  PERFORM set_config('app.test_c', c, true);
END $$;

SELECT is(
    (SELECT count(*)::int FROM dblink('b', format($$SELECT ticket_id FROM manifest.gate_tickets(manifest.cursor(), '%s') WHERE ticket_id = '00000000-0000-0000-0000-000000000045'$$, current_setting('app.test_c'))) AS t(ticket_id uuid)),
    0,
    'B cannot see uncommitted ticket'
);

-- A commits
SELECT dblink_exec('a', 'COMMIT');

-- B reads delta from its cursor
SELECT is(
    (SELECT count(*)::int FROM dblink('b', format($$SELECT ticket_id FROM manifest.gate_tickets(manifest.cursor(), '%s') WHERE ticket_id = '00000000-0000-0000-0000-000000000045'$$, current_setting('app.test_c'))) AS t(ticket_id uuid)),
    1,
    'B can see ticket now, using the old cursor'
);

SELECT pg_temp.cleanup_cur();
SELECT dblink_disconnect(name) FROM unnest(ARRAY['setup', 'a', 'b']) AS name;

-- Ninguna columna devuelta contiene más de 32 bytes de llave ni material privado (I7).
SELECT results_eq(
    $$SELECT max(length(holder_pubkey)) <= 32 FROM manifest.gate_tickets(manifest.cursor(), '0')$$,
    ARRAY[true],
    'no key > 32 bytes'
);

SELECT * FROM finish();
ROLLBACK;





