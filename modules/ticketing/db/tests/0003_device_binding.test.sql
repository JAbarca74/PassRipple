BEGIN;
SELECT plan(31);

-- ── Superuser setup ──────────────────────────────────────────────────────────
INSERT INTO identity.organizations (id, name, verified_at) VALUES
  ('00000000-0000-4000-8000-00000000000a', 'Org 1', now());
INSERT INTO identity.users (id, is_admin) VALUES
  ('00000000-0000-4000-8000-00000000000b', false),
  ('00000000-0000-4000-8000-00000000000c', true);
INSERT INTO jurisdictions.jurisdictions (canton_code, name, tax_rate_bps, courtesy_deduct_bps, settlement_rule) VALUES
  ('TEST-01', 'Test', 0, '{}', 'next_business_day');
INSERT INTO events.events (id, org_id, canton_code, name, venue_name, starts_at, age_rating, permitted_capacity, status, published_at) VALUES
  ('00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-00000000000a', 'TEST-01', 'Event 1', 'Venue', now(), 'all', 10, 'on_sale', now());

INSERT INTO catalog.ticket_types (id, event_id, name, price_crc, audience, entry_mode) VALUES
  ('00000000-0000-4000-8000-000000000020', '00000000-0000-4000-8000-000000000010', 'Public 1', 1000, 'public', 'single_use');

-- code_human valid
INSERT INTO ticketing.tickets (id, event_id, ticket_type_id, origin, code_human) VALUES
  ('00000000-0000-4000-8000-000000000040', '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000020', 'courtesy', 'C0DE400000'),
  ('00000000-0000-4000-8000-000000000041', '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000020', 'courtesy', 'C0DE410000'),
  ('00000000-0000-4000-8000-000000000042', '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000020', 'courtesy', 'C0DE420000');

UPDATE ticketing.tickets SET status = 'issued' WHERE id IN ('00000000-0000-4000-8000-000000000040', '00000000-0000-4000-8000-000000000041');
UPDATE ticketing.tickets SET status = 'void' WHERE id = '00000000-0000-4000-8000-000000000042';

-- Check code_human length
SELECT throws_ok(
  $$ INSERT INTO ticketing.tickets (id, event_id, ticket_type_id, origin, code_human) VALUES ('00000000-0000-4000-8000-000000000043', '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000020', 'courtesy', 'C0DE4') $$,
  '23514', NULL, 'code_human with 5 chars fails check constraint'
);
SELECT throws_ok(
  $$ INSERT INTO ticketing.tickets (id, event_id, ticket_type_id, origin, code_human) VALUES ('00000000-0000-4000-8000-000000000044', '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000020', 'courtesy', 'C0DE4400000') $$,
  '23514', NULL, 'code_human with 11 chars fails check constraint'
);

-- ── API (ticketing.bind) ─────────────────────────────────────────────────────
SET LOCAL SESSION AUTHORIZATION passripple_api;
SELECT identity.set_actor(NULL, 'buyer');

SELECT throws_ok(
  $$ SELECT ticketing.bind('00000000-0000-4000-8000-000000000040', decode('0000000000000000000000000000000000000000000000000000000000000000', 'hex'), 'bind') $$,
  '42501', NULL, 'only system can bind'
);

SELECT identity.set_actor(NULL, 'system');

-- Bind on unsold ticket -> throws
SELECT throws_ok(
  $$ SELECT ticketing.bind('00000000-0000-4000-8000-000000000042', decode('0000000000000000000000000000000000000000000000000000000000000000', 'hex'), 'bind') $$,
  '23001', 'ticket 00000000-0000-4000-8000-000000000042 is void, so it cannot be bound', 'bind only on issued'
);

-- Inexistent -> no data found
SELECT throws_ok(
  $$ SELECT ticketing.bind('00000000-0000-4000-8000-000000000099', decode('0000000000000000000000000000000000000000000000000000000000000000', 'hex'), 'bind') $$,
  'P0002', NULL, 'bind on nonexistent ticket'
);

-- Valid bind
SELECT is(
  (SELECT ticketing.bind('00000000-0000-4000-8000-000000000040', decode('1111111111111111111111111111111111111111111111111111111111111111', 'hex'), 'bind')),
  1::smallint,
  'valid bind returns key version 1'
);

-- Transfer on non-bound -> throws
SELECT throws_ok(
  $$ SELECT ticketing.bind('00000000-0000-4000-8000-000000000041', decode('1111111111111111111111111111111111111111111111111111111111111111', 'hex'), 'transfer') $$,
  '23001', 'ticket 00000000-0000-4000-8000-000000000041 is issued, so it cannot be rebound', 'transfer on issued fails'
);

-- Unknown reason
SELECT throws_ok(
  $$ SELECT ticketing.bind('00000000-0000-4000-8000-000000000040', decode('2222222222222222222222222222222222222222222222222222222222222222', 'hex'), 'unknown') $$,
  '23514', NULL, 'unknown reason throws'
);

-- Same key -> error
SELECT throws_ok(
  $$ SELECT ticketing.bind('00000000-0000-4000-8000-000000000040', decode('1111111111111111111111111111111111111111111111111111111111111111', 'hex'), 'transfer') $$,
  '23001', 'ticket 00000000-0000-4000-8000-000000000040 is already bound to this key', 'same key throws'
);

-- 31/33 bytes key -> error
SELECT throws_ok(
  $$ SELECT ticketing.bind('00000000-0000-4000-8000-000000000040', decode('11111111111111111111111111111111111111111111111111111111111111', 'hex'), 'transfer') $$,
  '23514', NULL, '31 bytes key throws check constraint'
);

-- Max 6 versions
SELECT is(
  (SELECT ticketing.bind('00000000-0000-4000-8000-000000000040', decode('2222222222222222222222222222222222222222222222222222222222222222', 'hex'), 'transfer')),
  2::smallint, 'transfer returns version 2'
);
SELECT ticketing.bind('00000000-0000-4000-8000-000000000040', decode('3333333333333333333333333333333333333333333333333333333333333333', 'hex'), 'recovery');
SELECT ticketing.bind('00000000-0000-4000-8000-000000000040', decode('4444444444444444444444444444444444444444444444444444444444444444', 'hex'), 'transfer');
SELECT ticketing.bind('00000000-0000-4000-8000-000000000040', decode('5555555555555555555555555555555555555555555555555555555555555555', 'hex'), 'recovery');
SELECT ticketing.bind('00000000-0000-4000-8000-000000000040', decode('6666666666666666666666666666666666666666666666666666666666666666', 'hex'), 'transfer');
SELECT throws_ok(
  $$ SELECT ticketing.bind('00000000-0000-4000-8000-000000000040', decode('7777777777777777777777777777777777777777777777777777777777777777', 'hex'), 'transfer') $$,
  '23514', NULL, 'version 7 throws'
);

-- RLS: api can select its tickets
SELECT identity.set_actor(NULL, 'buyer');
SELECT is((SELECT count(*) FROM ticketing.ticket_bindings), 0::bigint, 'buyer sees 0 bindings');

SELECT identity.set_actor('00000000-0000-4000-8000-00000000000c', 'admin');
SELECT is((SELECT count(*) FROM ticketing.ticket_bindings), 6::bigint, 'admin sees bindings');

SELECT throws_ok(
  $$ INSERT INTO ticketing.ticket_bindings (ticket_id, key_version, holder_pubkey, reason) VALUES ('00000000-0000-4000-8000-000000000040', 7, decode('7777777777777777777777777777777777777777777777777777777777777777', 'hex'), 'transfer') $$,
  '42501', NULL, 'api cannot insert binding'
);

-- ── Rules as owner (SQL directo) ─────────────────────────────────────────────
RESET SESSION AUTHORIZATION;
SET LOCAL ROLE passripple_owner_ticketing;

-- lowering key_version
SELECT throws_ok(
  $$ UPDATE ticketing.tickets SET key_version = 5 WHERE id = '00000000-0000-4000-8000-000000000040' $$,
  '23001', 'ticket 00000000-0000-4000-8000-000000000040: the key version changes only with the key', 'cannot change key_version alone'
);

-- up without changing key
SELECT throws_ok(
  $$ UPDATE ticketing.tickets SET key_version = 7 WHERE id = '00000000-0000-4000-8000-000000000040' $$,
  '23001', 'ticket 00000000-0000-4000-8000-000000000040: the key version changes only with the key', 'cannot change key_version alone'
);

-- changing key without upping version
SELECT throws_ok(
  $$ UPDATE ticketing.tickets SET holder_pubkey = decode('7777777777777777777777777777777777777777777777777777777777777777', 'hex') WHERE id = '00000000-0000-4000-8000-000000000040' $$,
  '23001', 'ticket 00000000-0000-4000-8000-000000000040: a new key takes key version 7', 'key change requires new key version'
);

-- jump two versions
SELECT throws_ok(
  $$ UPDATE ticketing.tickets SET holder_pubkey = decode('7777777777777777777777777777777777777777777777777777777777777777', 'hex'), key_version = 8 WHERE id = '00000000-0000-4000-8000-000000000040' $$,
  '23001', 'ticket 00000000-0000-4000-8000-000000000040: a new key takes key version 7', 'cannot skip versions'
);

-- changing key without row in bindings
SELECT throws_ok(
  $$ UPDATE ticketing.tickets SET holder_pubkey = decode('7777777777777777777777777777777777777777777777777777777777777777', 'hex'), key_version = 7 WHERE id = '00000000-0000-4000-8000-000000000040' $$,
  '23001', 'ticket 00000000-0000-4000-8000-000000000040: key version 7 has no binding record', 'requires binding record'
);

-- setting key to NULL on a bound ticket
SELECT throws_ok(
  $$ UPDATE ticketing.tickets SET holder_pubkey = NULL WHERE id = '00000000-0000-4000-8000-000000000040' $$,
  '23001', 'ticket 00000000-0000-4000-8000-000000000040: a key is only ever replaced by another, on a bound ticket', 'cannot set key to null'
);

-- revincular una anulada
SELECT throws_ok(
  $$ UPDATE ticketing.tickets SET status = 'bound', key_version = 1, holder_pubkey = decode('1111111111111111111111111111111111111111111111111111111111111111', 'hex') WHERE id = '00000000-0000-4000-8000-000000000042' $$,
  '23001', 'ticket 00000000-0000-4000-8000-000000000042: void cannot become bound', 'voided cannot be rebound'
);

-- inserting ticket bound
SELECT throws_ok(
  $$ INSERT INTO ticketing.tickets (id, event_id, ticket_type_id, origin, code_human, status) VALUES ('00000000-0000-4000-8000-000000000045', '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000020', 'courtesy', 'C0DE450000', 'bound') $$,
  '23001', 'a ticket is issued unbound; bind it with ticketing.bind', 'starts unbound'
);

-- inserting ticket with key_version != 0
SELECT throws_ok(
  $$ INSERT INTO ticketing.tickets (id, event_id, ticket_type_id, origin, code_human, key_version) VALUES ('00000000-0000-4000-8000-000000000045', '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000020', 'courtesy', 'C0DE450000', 1) $$,
  '23001', 'a ticket is issued unbound; bind it with ticketing.bind', 'starts unbound'
);

-- UPDATE / DELETE / TRUNCATE ticket_bindings
SELECT throws_ok(
  $$ UPDATE ticketing.ticket_bindings SET key_version = 7 WHERE ticket_id = '00000000-0000-4000-8000-000000000040' $$,
  '23001', NULL, 'bindings are append-only'
);
SELECT throws_ok(
  $$ DELETE FROM ticketing.ticket_bindings WHERE ticket_id = '00000000-0000-4000-8000-000000000040' $$,
  '23001', NULL, 'bindings are append-only'
);

-- Insert binding row that is not next version
SELECT throws_ok(
  $$ INSERT INTO ticketing.ticket_bindings (ticket_id, key_version, holder_pubkey, reason) VALUES ('00000000-0000-4000-8000-000000000041', 2, decode('1111111111111111111111111111111111111111111111111111111111111111', 'hex'), 'transfer') $$,
  '23001', 'ticket 00000000-0000-4000-8000-000000000041: the next key version is 1, not 2', 'must insert next version'
);

-- Insert binding row without moving the ticket fails at COMMIT
SET CONSTRAINTS ALL IMMEDIATE;
SELECT throws_ok(
  $$ INSERT INTO ticketing.ticket_bindings (ticket_id, key_version, holder_pubkey, reason) VALUES ('00000000-0000-4000-8000-000000000041', 1, decode('1111111111111111111111111111111111111111111111111111111111111111', 'hex'), 'bind') $$,
  '23001', 'ticket 00000000-0000-4000-8000-000000000041 never moved to key version 1', 'must apply binding'
);

SELECT * FROM finish(true);
ROLLBACK;





