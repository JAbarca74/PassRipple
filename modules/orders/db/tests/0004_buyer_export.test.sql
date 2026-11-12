BEGIN;
SELECT plan(33);

-- ── Superuser setup ──────────────────────────────────────────────────────────
INSERT INTO identity.organizations (id, name, verified_at) VALUES
  ('00000000-0000-4000-8000-00000000000a', 'Org 1', now());

INSERT INTO jurisdictions.jurisdictions (canton_code, name, tax_rate_bps, courtesy_deduct_bps, settlement_rule) VALUES
  ('TEST-01', 'Test', 0, '{}', 'next_business_day');

INSERT INTO events.events (id, org_id, canton_code, name, venue_name, starts_at, ends_at, age_rating, permitted_capacity, status, published_at) VALUES
  ('00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-00000000000a', 'TEST-01', 'Export Event', 'Main Arena', now() + interval '1 day', now() + interval '2 days', 'all', 100, 'on_sale', now());

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

-- ── Place orders and record consents as buyer ────────────────────────────────
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
    'idem_buyer_export_01',
    'buyer@example.com',
    '+50688887777',
    '11111111111111111111111111111111',
    '{BUYER01}'::text[],
    500,
    65,
    'standard_v1',
    0
  );

SELECT privacy.record_consent(
  (SELECT id FROM test_data WHERE name = 'buyer_order'),
  'terms',
  true,
  'v1',
  'checkout'
);
SELECT privacy.record_consent(
  (SELECT id FROM test_data WHERE name = 'buyer_order'),
  'privacy',
  true,
  'v2',
  'checkout'
);

-- Another buyer's order that must NOT appear in buyer@example.com's export
INSERT INTO test_data (name, id)
VALUES ('other_hold', inventory.hold(
  '00000000-0000-4000-8000-000000000010',
  '00000000-0000-4000-8000-000000000021',
  1
));

INSERT INTO test_data (name, id)
SELECT 'other_order', order_id
  FROM orders.place(
    (SELECT id FROM test_data WHERE name = 'other_hold'),
    'idem_other_export_01',
    'other@example.com',
    NULL,
    '22222222222222222222222222222222',
    '{OTHER01}'::text[],
    800,
    104,
    'standard_v1',
    0
  );

SELECT privacy.record_consent(
  (SELECT id FROM test_data WHERE name = 'other_order'),
  'terms',
  true,
  'v1',
  'checkout'
);

-- ── Mark paid, issue tickets, bind and transfer as system ────────────────────
SELECT set_config('app.actor_role', 'system', true);

SELECT orders.mark_paid((SELECT id FROM test_data WHERE name = 'buyer_order'));
SELECT orders.mark_paid((SELECT id FROM test_data WHERE name = 'other_order'));

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

INSERT INTO test_data (name, id)
SELECT 'ticket_transferred', id FROM ticketing.tickets WHERE code_human = 'C0DE000001';

INSERT INTO test_data (name, id)
SELECT 'ticket_kept', id FROM ticketing.tickets WHERE code_human = 'C0DE000002';

-- Bind both tickets to buyer's device (key 1, key_version = 1)
SELECT ticketing.bind(
  (SELECT id FROM test_data WHERE name = 'ticket_transferred'),
  decode('1111111111111111111111111111111111111111111111111111111111111111', 'hex'),
  'bind'
);
SELECT ticketing.bind(
  (SELECT id FROM test_data WHERE name = 'ticket_kept'),
  decode('1111111111111111111111111111111111111111111111111111111111111111', 'hex'),
  'bind'
);

-- Buyer offers transfer 1 (superseded) and transfer 2 (claimed by receiver) on ticket_transferred
SELECT ticketing.offer_transfer(
  (SELECT id FROM test_data WHERE name = 'ticket_transferred'),
  decode('1111111111111111111111111111111111111111111111111111111111111111', 'hex'),
  'prx_buyer_offer_1_0000000000000001',
  interval '1 hour'
);
SELECT ticketing.offer_transfer(
  (SELECT id FROM test_data WHERE name = 'ticket_transferred'),
  decode('1111111111111111111111111111111111111111111111111111111111111111', 'hex'),
  'prx_buyer_offer_2_0000000000000002',
  interval '2 hours'
);

-- Receiver claims transfer 2 -> binds to key 2 with reason 'transfer' (key_version = 2)
SELECT ticketing.claim_transfer(
  'prx_buyer_offer_2_0000000000000002',
  decode('2222222222222222222222222222222222222222222222222222222222222222', 'hex'),
  'prh_receiver_1_token_0000000000001'
);

-- Receiver subsequently offers and transfers to a second receiver (from_key_version = 2, key_version = 3):
-- none of this receiver history may appear in the original buyer's export.
SELECT ticketing.offer_transfer(
  (SELECT id FROM test_data WHERE name = 'ticket_transferred'),
  decode('2222222222222222222222222222222222222222222222222222222222222222', 'hex'),
  'prx_receiver_offer_000000000000003',
  interval '1 hour'
);
SELECT ticketing.claim_transfer(
  'prx_receiver_offer_000000000000003',
  decode('3333333333333333333333333333333333333333333333333333333333333333', 'hex'),
  'prh_receiver_2_token_0000000000002'
);

-- ── 1. CHECK constraint on orders.contact_codes.purpose ──────────────────────
SELECT lives_ok(
  $$ SELECT orders.request_contact_code('buyer@example.com', 'export', decode('0101010101010101010101010101010101010101010101010101010101010101', 'hex'), interval '10 minutes') $$,
  'contact_codes_purpose_check accepts export purpose'
);

SELECT throws_ok(
  $$ SELECT orders.request_contact_code('buyer@example.com', 'unknown_purpose', decode('0202020202020202020202020202020202020202020202020202020202020202', 'hex'), interval '10 minutes') $$,
  '23514', NULL, 'contact_codes_purpose_check rejects unknown purpose'
);

INSERT INTO test_data (name, id)
SELECT 'export_code', code_id
  FROM orders.contact_code_challenge('buyer@example.com', 'export');

-- ── 2. Invalid codes and wrong purposes get 42501 ────────────────────────────
SELECT throws_ok(
  $$ SELECT orders.buyer_export((SELECT id FROM test_data WHERE name = 'export_code')) $$,
  '42501', NULL, 'unused export code raises 42501'
);

-- Mark the export code used, then age its used_at past 5 minutes to test expiry
SELECT orders.use_contact_code((SELECT id FROM test_data WHERE name = 'export_code'));
UPDATE orders.contact_codes
   SET used_at = now() - interval '6 minutes'
 WHERE id = (SELECT id FROM test_data WHERE name = 'export_code');

SELECT throws_ok(
  $$ SELECT orders.buyer_export((SELECT id FROM test_data WHERE name = 'export_code')) $$,
  '42501', NULL, 'export code used more than 5 minutes ago raises 42501'
);

-- Restore used_at to now() so export_code is freshly used
UPDATE orders.contact_codes
   SET used_at = now()
 WHERE id = (SELECT id FROM test_data WHERE name = 'export_code');

-- Recovery code (used) raises 42501
SELECT orders.request_contact_code('buyer@example.com', 'recovery', decode('0303030303030303030303030303030303030303030303030303030303030303', 'hex'), interval '10 minutes');
INSERT INTO test_data (name, id)
SELECT 'used_recovery_code', code_id
  FROM orders.contact_code_challenge('buyer@example.com', 'recovery');
SELECT orders.use_contact_code((SELECT id FROM test_data WHERE name = 'used_recovery_code'));

SELECT throws_ok(
  $$ SELECT orders.buyer_export((SELECT id FROM test_data WHERE name = 'used_recovery_code')) $$,
  '42501', NULL, 'used recovery code raises 42501'
);

-- Erasure code (used) raises 42501
SELECT orders.request_contact_code('buyer@example.com', 'erasure', decode('0404040404040404040404040404040404040404040404040404040404040404', 'hex'), interval '10 minutes');
INSERT INTO test_data (name, id)
SELECT 'used_erasure_code', code_id
  FROM orders.contact_code_challenge('buyer@example.com', 'erasure');
SELECT orders.use_contact_code((SELECT id FROM test_data WHERE name = 'used_erasure_code'));

SELECT throws_ok(
  $$ SELECT orders.buyer_export((SELECT id FROM test_data WHERE name = 'used_erasure_code')) $$,
  '42501', NULL, 'used erasure code raises 42501'
);

-- ── 3. Non-system actors get 42501 even with a valid used export code ────────
SELECT set_config('app.actor_role', 'buyer', true);
SELECT throws_ok(
  $$ SELECT orders.buyer_export((SELECT id FROM test_data WHERE name = 'export_code')) $$,
  '42501', NULL, 'buyer actor cannot call buyer_export'
);

SELECT set_config('app.actor_role', 'admin', true);
SELECT throws_ok(
  $$ SELECT orders.buyer_export((SELECT id FROM test_data WHERE name = 'export_code')) $$,
  '42501', NULL, 'admin actor cannot call buyer_export'
);

SELECT set_config('app.actor_role', '', true);
SELECT throws_ok(
  $$ SELECT orders.buyer_export((SELECT id FROM test_data WHERE name = 'export_code')) $$,
  '42501', NULL, 'actor with no role cannot call buyer_export'
);

-- ── 4. Executable by passripple_api and valid export content ─────────────────
SELECT ok(
  has_function_privilege('passripple_api', 'orders.buyer_export(uuid)', 'EXECUTE'),
  'orders.buyer_export is executable by passripple_api'
);

SET LOCAL SESSION AUTHORIZATION passripple_api;
SELECT identity.set_actor(NULL, 'system');

INSERT INTO test_exports (name, doc)
VALUES (
  'initial',
  orders.buyer_export((SELECT id FROM test_data WHERE name = 'export_code'))
);

RESET SESSION AUTHORIZATION;
SELECT set_config('app.actor_role', 'system', true);

-- Contact email
SELECT is(
  (SELECT doc #>> '{contact,email}' FROM test_exports WHERE name = 'initial'),
  'buyer@example.com',
  'export contact.email matches code email'
);

-- Only buyer@example.com orders returned (other@example.com excluded)
SELECT is(
  (SELECT jsonb_array_length(doc -> 'orders') FROM test_exports WHERE name = 'initial'),
  1,
  'only orders for the export code email are returned'
);

SELECT is(
  (SELECT doc #>> '{orders,0,orderCode}' FROM test_exports WHERE name = 'initial'),
  'BUYER01',
  'returned order is BUYER01 and not OTHER01'
);

SELECT is(
  (SELECT (doc #>> '{orders,0,amountCrc}')::int FROM test_exports WHERE name = 'initial'),
  11130,
  'order amountCrc matches 2 * (5000 + 500 + 65)'
);

-- Order items carry right typeName, quantity, and prices
SELECT is(
  (SELECT doc #> '{orders,0,items}' FROM test_exports WHERE name = 'initial'),
  jsonb_build_array(
    jsonb_build_object(
      'typeName', 'General',
      'quantity', 2,
      'unitPriceCrc', 5000,
      'unitFeeCrc', 500,
      'unitFeeTaxCrc', 65
    )
  ),
  'order items carry expected typeName, quantity, unitPriceCrc, unitFeeCrc, unitFeeTaxCrc'
);

-- Consents recorded with privacy.record_consent for that order appear
SELECT is(
  (SELECT jsonb_array_length(doc #> '{orders,0,consents}') FROM test_exports WHERE name = 'initial'),
  2,
  'both consents recorded for the buyer order appear'
);

SELECT is(
  (SELECT jsonb_agg(c ->> 'purpose') FROM jsonb_array_elements((SELECT doc #> '{orders,0,consents}' FROM test_exports WHERE name = 'initial')) c),
  jsonb_build_array('privacy', 'terms'),
  'consents carry recorded purposes'
);

SELECT is(
  (SELECT doc #>> '{orders,0,consents,0,documentVersion}' FROM test_exports WHERE name = 'initial'),
  'v2',
  'consent carries documentVersion'
);

SELECT is(
  (SELECT doc #>> '{orders,0,consents,0,source}' FROM test_exports WHERE name = 'initial'),
  'checkout',
  'consent carries source'
);

-- contactCodes lists the codes of that email
SELECT is(
  (SELECT jsonb_array_length(doc -> 'contactCodes') FROM test_exports WHERE name = 'initial'),
  3,
  'contactCodes lists all 3 codes requested for buyer@example.com'
);

SELECT is(
  (SELECT jsonb_agg(c ->> 'purpose' ORDER BY c ->> 'purpose') FROM jsonb_array_elements((SELECT doc -> 'contactCodes' FROM test_exports WHERE name = 'initial')) c),
  jsonb_build_array('erasure', 'export', 'recovery'),
  'contactCodes purposes match requested codes for buyer@example.com'
);

-- ── 5. Transferred vs untransferred ticket details ───────────────────────────
-- Note: tickets are ordered by issuedAt, then humanCode. Both were issued in the same
-- statement (same transaction_timestamp() created_at); 'C0DE000002' comes first because
-- 'C0DE000002' < NULL in ASC (NULLS LAST) ordering, and the transferred ticket (humanCode NULL) is second.
SELECT is(
  (SELECT jsonb_array_length(doc #> '{orders,0,tickets}') FROM test_exports WHERE name = 'initial'),
  2,
  'order has 2 exported tickets'
);

-- Untransferred ticket (index 0) shows its code_human and bound status
SELECT is(
  (SELECT doc #>> '{orders,0,tickets,0,humanCode}' FROM test_exports WHERE name = 'initial'),
  'C0DE000002',
  'untransferred ticket shows its code_human'
);

SELECT is(
  (SELECT doc #>> '{orders,0,tickets,0,status}' FROM test_exports WHERE name = 'initial'),
  'bound',
  'untransferred ticket shows its current status'
);

SELECT is(
  (SELECT jsonb_typeof(doc #> '{orders,0,tickets,0,transferredAt}') FROM test_exports WHERE name = 'initial'),
  'null',
  'untransferred ticket has null transferredAt'
);

-- Transferred ticket (index 1) shows status transferred, humanCode null, transferredAt set
SELECT is(
  (SELECT doc #>> '{orders,0,tickets,1,status}' FROM test_exports WHERE name = 'initial'),
  'transferred',
  'transferred ticket shows status transferred'
);

SELECT is(
  (SELECT jsonb_typeof(doc #> '{orders,0,tickets,1,humanCode}') FROM test_exports WHERE name = 'initial'),
  'null',
  'transferred ticket has null humanCode'
);

SELECT is(
  (SELECT jsonb_typeof(doc #> '{orders,0,tickets,1,transferredAt}') FROM test_exports WHERE name = 'initial'),
  'string',
  'transferred ticket has transferredAt timestamp set'
);

-- Transferred ticket bindings exclude the transfer binding (key_version 2) and later receiver bindings (key_version 3)
SELECT is(
  (SELECT jsonb_agg(b ->> 'reason') FROM jsonb_array_elements((SELECT doc #> '{orders,0,tickets,1,bindings}' FROM test_exports WHERE name = 'initial')) b),
  jsonb_build_array('bind'),
  'transferred ticket bindings include only pre-transfer bindings (receiver bindings excluded)'
);

-- Transferred ticket transferOffers include the buyer offers (from_key_version 1) and exclude receiver offers (from_key_version 2)
SELECT is(
  (SELECT jsonb_array_length(doc #> '{orders,0,tickets,1,transferOffers}') FROM test_exports WHERE name = 'initial'),
  2,
  'transferred ticket transferOffers include only offers before the transfer'
);

SELECT ok(
  (SELECT bool_or((o ->> 'cancelledAt') IS NOT NULL)
      AND bool_or((o ->> 'claimedAt') IS NOT NULL)
     FROM jsonb_array_elements((SELECT doc #> '{orders,0,tickets,1,transferOffers}' FROM test_exports WHERE name = 'initial')) o),
  'buyer transferOffers record cancelledAt on first offer and claimedAt on second offer'
);

-- ── 6. Erased order no longer appears ────────────────────────────────────────
-- Move event window into the past so erasure_blockers allows erasing buyer@example.com
UPDATE events.events
   SET starts_at = now() - interval '2 days',
       ends_at = now() - interval '1 day'
 WHERE id = '00000000-0000-4000-8000-000000000010';

SELECT is(
  orders.erase_buyer((SELECT id FROM test_data WHERE name = 'used_erasure_code')),
  1,
  'orders.erase_buyer erases the buyer order'
);

-- Request and use a fresh export code after erasure
SELECT orders.request_contact_code('buyer@example.com', 'export', decode('0606060606060606060606060606060606060606060606060606060606060606', 'hex'), interval '10 minutes');
INSERT INTO test_data (name, id)
SELECT 'post_erasure_export_code', code_id
  FROM orders.contact_code_challenge('buyer@example.com', 'export');
SELECT orders.use_contact_code((SELECT id FROM test_data WHERE name = 'post_erasure_export_code'));

SELECT is(
  (SELECT orders.buyer_export((SELECT id FROM test_data WHERE name = 'post_erasure_export_code')) -> 'orders'),
  '[]'::jsonb,
  'erased order no longer appears in buyer_export'
);

SELECT * FROM finish();
ROLLBACK;
