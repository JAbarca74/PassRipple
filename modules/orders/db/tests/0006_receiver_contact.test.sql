BEGIN;
SELECT plan(20);

-- ── Superuser setup ──────────────────────────────────────────────────────────
INSERT INTO identity.organizations (id, name, verified_at) VALUES
  ('00000000-0000-4000-8000-00000000000a', 'Org 1', now());

INSERT INTO jurisdictions.jurisdictions (canton_code, name, tax_rate_bps, courtesy_deduct_bps, settlement_rule) VALUES
  ('TEST-01', 'Test', 0, '{}', 'next_business_day');

INSERT INTO events.events (id, org_id, canton_code, name, venue_name, starts_at, ends_at, age_rating, permitted_capacity, status, published_at) VALUES
  ('00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-00000000000a', 'TEST-01', 'Concert Alpha', 'Main Arena', now() + interval '1 day', now() + interval '2 days', 'all', 100, 'on_sale', now());

INSERT INTO catalog.ticket_types (id, event_id, name, price_crc, audience, entry_mode) VALUES
  ('00000000-0000-4000-8000-000000000020', '00000000-0000-4000-8000-000000000010', 'General', 5000, 'public', 'single_use'),
  ('00000000-0000-4000-8000-000000000021', '00000000-0000-4000-8000-000000000010', 'VIP', 10000, 'public', 'single_use');

INSERT INTO inventory.event_capacity (event_id, permitted_capacity, committed) VALUES
  ('00000000-0000-4000-8000-000000000010', 100, 0);

CREATE TEMPORARY TABLE test_data (
  name text PRIMARY KEY,
  id   uuid NOT NULL
);

CREATE TEMPORARY TABLE test_exports (
  name text  PRIMARY KEY,
  doc  jsonb NOT NULL
);

GRANT SELECT ON test_data TO passripple_api;
GRANT INSERT, SELECT ON test_exports TO passripple_api;

-- ── Place order as buyer ─────────────────────────────────────────────────────
SELECT set_config('app.actor_role', 'buyer', true);
SELECT set_config('app.actor_id', '', true);

INSERT INTO test_data (name, id)
VALUES ('buyer_hold', inventory.hold(
  '00000000-0000-4000-8000-000000000010',
  '00000000-0000-4000-8000-000000000020',
  2
));

INSERT INTO test_data (name, id)
SELECT 'buyer_order', order_id
  FROM orders.place(
    (SELECT id FROM test_data WHERE name = 'buyer_hold'),
    'idem_receiver_contact_01',
    'buyer@example.com',
    NULL,
    '11111111111111111111111111111111',
    '{BUYER01}'::text[],
    500,
    65,
    'standard_v1',
    0
  );

-- ── Mark paid, issue tickets, bind and transfer as system ────────────────────
SELECT set_config('app.actor_role', 'system', true);

SELECT orders.mark_paid((SELECT id FROM test_data WHERE name = 'buyer_order'));

SELECT ticketing.issue_order(
  '00000000-0000-4000-8000-000000000090'::uuid,
  (SELECT id FROM test_data WHERE name = 'buyer_order'),
  '00000000-0000-4000-8000-000000000010'::uuid,
  jsonb_build_array(
    jsonb_build_object(
      'ticketTypeId', '00000000-0000-4000-8000-000000000020',
      'codes', jsonb_build_array('C0DE000001', 'C0DE000002')
    )
  )
);

-- Also insert a VIP courtesy ticket for variety in typeName
INSERT INTO ticketing.tickets (id, event_id, ticket_type_id, origin, code_human) VALUES
  ('00000000-0000-4000-8000-000000000043', '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000021', 'courtesy', 'C0DE000003');

INSERT INTO test_data (name, id)
SELECT 'ticket_passed_on', id FROM ticketing.tickets WHERE code_human = 'C0DE000001';

INSERT INTO test_data (name, id)
SELECT 'ticket_other_email', id FROM ticketing.tickets WHERE code_human = 'C0DE000002';

INSERT INTO test_data (name, id)
VALUES ('ticket_kept_vip', '00000000-0000-4000-8000-000000000043');

-- Bind all three tickets to initial key 1
SELECT ticketing.bind((SELECT id FROM test_data WHERE name = 'ticket_passed_on'), decode('1111111111111111111111111111111111111111111111111111111111111111', 'hex'), 'bind');
SELECT ticketing.bind((SELECT id FROM test_data WHERE name = 'ticket_other_email'), decode('1111111111111111111111111111111111111111111111111111111111111111', 'hex'), 'bind');
SELECT ticketing.bind((SELECT id FROM test_data WHERE name = 'ticket_kept_vip'), decode('1111111111111111111111111111111111111111111111111111111111111111', 'hex'), 'bind');

-- 1) ticket_passed_on: claimed by receiver@example.com, then passed on to third@example.com
SELECT ticketing.offer_transfer((SELECT id FROM test_data WHERE name = 'ticket_passed_on'), decode('1111111111111111111111111111111111111111111111111111111111111111', 'hex'), 'prx_offer_passed_1_00000000000001', interval '1 hour');
SELECT ticketing.claim_transfer('prx_offer_passed_1_00000000000001', decode('2222222222222222222222222222222222222222222222222222222222222222', 'hex'), 'prh_receiver_passed_1_00000000001', 'receiver@example.com');
UPDATE ticketing.transfers
   SET created_at = now() - interval '20 minutes',
       claimed_at = now() - interval '10 minutes'
 WHERE offer_hash = sha256(convert_to('prx_offer_passed_1_00000000000001', 'UTF8'));

SELECT ticketing.offer_transfer((SELECT id FROM test_data WHERE name = 'ticket_passed_on'), decode('2222222222222222222222222222222222222222222222222222222222222222', 'hex'), 'prx_offer_passed_2_00000000000002', interval '1 hour');
SELECT ticketing.claim_transfer('prx_offer_passed_2_00000000000002', decode('3333333333333333333333333333333333333333333333333333333333333333', 'hex'), 'prh_receiver_passed_2_00000000002', 'third@example.com');

-- 2) ticket_kept_vip: claimed by receiver@example.com and still held
SELECT ticketing.offer_transfer((SELECT id FROM test_data WHERE name = 'ticket_kept_vip'), decode('1111111111111111111111111111111111111111111111111111111111111111', 'hex'), 'prx_offer_kept_vip_00000000000001', interval '1 hour');
SELECT ticketing.claim_transfer('prx_offer_kept_vip_00000000000001', decode('4444444444444444444444444444444444444444444444444444444444444444', 'hex'), 'prh_receiver_kept_vip_00000000001', 'receiver@example.com');

INSERT INTO test_data (name, id)
SELECT 'claim_kept_vip', id FROM ticketing.transfers WHERE offer_hash = sha256(convert_to('prx_offer_kept_vip_00000000000001', 'UTF8'));

-- 3) ticket_other_email: claimed by someone-else@example.com
SELECT ticketing.offer_transfer((SELECT id FROM test_data WHERE name = 'ticket_other_email'), decode('1111111111111111111111111111111111111111111111111111111111111111', 'hex'), 'prx_offer_other_em_00000000000001', interval '1 hour');
SELECT ticketing.claim_transfer('prx_offer_other_em_00000000000001', decode('5555555555555555555555555555555555555555555555555555555555555555', 'hex'), 'prh_receiver_other_em_00000000001', 'someone-else@example.com');

-- ── 1. Privileges ────────────────────────────────────────────────────────────
SELECT ok(
  has_function_privilege('passripple_api', 'orders.recoverable_held(uuid)', 'EXECUTE'),
  'orders.recoverable_held is executable by passripple_api'
);

SELECT ok(
  has_function_privilege('passripple_api', 'orders.received_export(uuid)', 'EXECUTE'),
  'orders.received_export is executable by passripple_api'
);

-- ── 2. request_contact_code ──────────────────────────────────────────────────
SELECT is(
  orders.request_contact_code('receiver@example.com', 'recovery', decode('0101010101010101010101010101010101010101010101010101010101010101', 'hex'), interval '10 minutes'),
  true,
  'request_contact_code returns true for email that only appears as holder_email'
);

SELECT is(
  orders.request_contact_code('unknown@example.com', 'recovery', decode('0202020202020202020202020202020202020202020202020202020202020202', 'hex'), interval '10 minutes'),
  false,
  'request_contact_code returns false for unknown email'
);

SELECT is(
  orders.request_contact_code('buyer@example.com', 'export', decode('0303030303030303030303030303030303030303030303030303030303030303', 'hex'), interval '10 minutes'),
  true,
  'request_contact_code returns true for buyer email'
);

-- ── 3. recoverable_held ──────────────────────────────────────────────────────
INSERT INTO test_data (name, id)
SELECT 'receiver_recovery_code', code_id
  FROM orders.contact_code_challenge('receiver@example.com', 'recovery');

-- Non-system actor rejected
SELECT set_config('app.actor_role', 'buyer', true);
SELECT throws_ok(
  $$ SELECT * FROM orders.recoverable_held((SELECT id FROM test_data WHERE name = 'receiver_recovery_code')) $$,
  '42501', NULL, 'non-system actor cannot call recoverable_held'
);

SELECT set_config('app.actor_role', 'system', true);

-- Unused recovery code returns 0 rows
SELECT is(
  (SELECT count(*) FROM orders.recoverable_held((SELECT id FROM test_data WHERE name = 'receiver_recovery_code'))),
  0::bigint,
  'unused recovery code returns 0 rows in recoverable_held'
);

-- Mark recovery code used, then age past 5 minutes
SELECT orders.use_contact_code((SELECT id FROM test_data WHERE name = 'receiver_recovery_code'));
UPDATE orders.contact_codes
   SET used_at = now() - interval '6 minutes'
 WHERE id = (SELECT id FROM test_data WHERE name = 'receiver_recovery_code');

SELECT is(
  (SELECT count(*) FROM orders.recoverable_held((SELECT id FROM test_data WHERE name = 'receiver_recovery_code'))),
  0::bigint,
  'recovery code used more than 5 minutes ago returns 0 rows in recoverable_held'
);

-- Restore used_at to now()
UPDATE orders.contact_codes
   SET used_at = now()
 WHERE id = (SELECT id FROM test_data WHERE name = 'receiver_recovery_code');

-- Export code (even when used) returns 0 rows in recoverable_held
SELECT orders.request_contact_code('receiver@example.com', 'export', decode('0404040404040404040404040404040404040404040404040404040404040404', 'hex'), interval '10 minutes');
INSERT INTO test_data (name, id)
SELECT 'receiver_export_code', code_id
  FROM orders.contact_code_challenge('receiver@example.com', 'export');
SELECT orders.use_contact_code((SELECT id FROM test_data WHERE name = 'receiver_export_code'));

SELECT is(
  (SELECT count(*) FROM orders.recoverable_held((SELECT id FROM test_data WHERE name = 'receiver_export_code'))),
  0::bigint,
  'used export code returns 0 rows in recoverable_held'
);

-- Valid used recovery code lists only current bound claim for that email (excludes passed-on claim and other emails)
SELECT is(
  (SELECT count(*) FROM orders.recoverable_held((SELECT id FROM test_data WHERE name = 'receiver_recovery_code'))),
  1::bigint,
  'recoverable_held returns only the 1 current bound claim for receiver@example.com'
);

SELECT is(
  (SELECT ROW(transfer_id, event_name) FROM orders.recoverable_held((SELECT id FROM test_data WHERE name = 'receiver_recovery_code'))),
  ROW((SELECT id FROM test_data WHERE name = 'claim_kept_vip'), 'Concert Alpha'::text),
  'recoverable_held returns the current claim transfer_id and event_name'
);

-- ── 4. received_export ───────────────────────────────────────────────────────
-- Non-system actor rejected
SELECT set_config('app.actor_role', 'buyer', true);
SELECT throws_ok(
  $$ SELECT orders.received_export((SELECT id FROM test_data WHERE name = 'receiver_export_code')) $$,
  '42501', NULL, 'non-system actor cannot call received_export'
);

SELECT set_config('app.actor_role', 'system', true);

-- Used recovery code rejected
SELECT throws_ok(
  $$ SELECT orders.received_export((SELECT id FROM test_data WHERE name = 'receiver_recovery_code')) $$,
  '42501', NULL, 'used recovery code raises 42501 in received_export'
);

-- Unused export code rejected
INSERT INTO test_data (name, id)
SELECT 'buyer_export_code', code_id
  FROM orders.contact_code_challenge('buyer@example.com', 'export');

SELECT throws_ok(
  $$ SELECT orders.received_export((SELECT id FROM test_data WHERE name = 'buyer_export_code')) $$,
  '42501', NULL, 'unused export code raises 42501 in received_export'
);

-- Export code used > 5 minutes ago rejected
SELECT orders.use_contact_code((SELECT id FROM test_data WHERE name = 'buyer_export_code'));
UPDATE orders.contact_codes
   SET used_at = now() - interval '6 minutes'
 WHERE id = (SELECT id FROM test_data WHERE name = 'buyer_export_code');

SELECT throws_ok(
  $$ SELECT orders.received_export((SELECT id FROM test_data WHERE name = 'buyer_export_code')) $$,
  '42501', NULL, 'export code used more than 5 minutes ago raises 42501 in received_export'
);

-- Restore used_at to now(): buyer@example.com has no received tickets -> returns '[]'
UPDATE orders.contact_codes
   SET used_at = now()
 WHERE id = (SELECT id FROM test_data WHERE name = 'buyer_export_code');

SELECT is(
  orders.received_export((SELECT id FROM test_data WHERE name = 'buyer_export_code')),
  '[]'::jsonb,
  'received_export returns [] when email has no received tickets'
);

-- Valid export for receiver@example.com
INSERT INTO test_exports (name, doc)
VALUES (
  'receiver',
  orders.received_export((SELECT id FROM test_data WHERE name = 'receiver_export_code'))
);

SELECT is(
  (SELECT jsonb_array_length(doc) FROM test_exports WHERE name = 'receiver'),
  2,
  'received_export returns both claims for receiver@example.com ordered by claimedAt'
);

-- First entry (passed on claim): event details, typeName, claimedAt, and status 'transferred'
SELECT is(
  (SELECT doc #> '{0,event}' FROM test_exports WHERE name = 'receiver'),
  jsonb_build_object(
    'name', 'Concert Alpha',
    'venueName', 'Main Arena',
    'startsAt', (SELECT starts_at FROM events.events WHERE id = '00000000-0000-4000-8000-000000000010')
  ),
  'received_export entry carries event name, venueName, and startsAt'
);

SELECT is(
  (SELECT jsonb_build_object(
     'typeName', doc #>> '{0,typeName}',
     'claimedAtType', jsonb_typeof(doc #> '{0,claimedAt}'),
     'status', doc #>> '{0,status}'
   ) FROM test_exports WHERE name = 'receiver'),
  jsonb_build_object(
    'typeName', 'General',
    'claimedAtType', 'string',
    'status', 'transferred'
  ),
  'passed-on claim has typeName General, claimedAt timestamp, and status transferred'
);

-- Second entry (current claim): typeName VIP and status 'bound'
SELECT is(
  (SELECT jsonb_build_object(
     'typeName', doc #>> '{1,typeName}',
     'claimedAtType', jsonb_typeof(doc #> '{1,claimedAt}'),
     'status', doc #>> '{1,status}'
   ) FROM test_exports WHERE name = 'receiver'),
  jsonb_build_object(
    'typeName', 'VIP',
    'claimedAtType', 'string',
    'status', 'bound'
  ),
  'current claim has typeName VIP, claimedAt timestamp, and status bound'
);

SELECT * FROM finish();
ROLLBACK;
