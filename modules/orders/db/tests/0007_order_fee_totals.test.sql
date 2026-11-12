BEGIN;
SELECT plan(7);

-- ── Superuser setup ──────────────────────────────────────────────────────────
INSERT INTO identity.organizations (id, name, verified_at) VALUES
  ('00000000-0000-4000-8000-00000000000a', 'Org 1', now());

INSERT INTO jurisdictions.jurisdictions (canton_code, name, tax_rate_bps, courtesy_deduct_bps, settlement_rule) VALUES
  ('TEST-01', 'Test', 0, '{}', 'next_business_day');

INSERT INTO events.events (id, org_id, canton_code, name, venue_name, starts_at, age_rating, permitted_capacity, status, published_at) VALUES
  ('00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-00000000000a', 'TEST-01', 'Event 1', 'Venue', now(), 'all', 100, 'on_sale', now());

INSERT INTO catalog.ticket_types (id, event_id, name, price_crc, audience) VALUES
  ('00000000-0000-4000-8000-000000000020', '00000000-0000-4000-8000-000000000010', 'General', 5000, 'public'),
  ('00000000-0000-4000-8000-000000000021', '00000000-0000-4000-8000-000000000010', 'VIP', 10000, 'public'),
  ('00000000-0000-4000-8000-000000000022', '00000000-0000-4000-8000-000000000010', 'Free', 0, 'public');

INSERT INTO inventory.event_capacity (event_id, permitted_capacity, committed) VALUES
  ('00000000-0000-4000-8000-000000000010', 100, 4);

INSERT INTO inventory.holds (id, event_id, ticket_type_id, quantity, expires_at) VALUES
  ('00000000-0000-4000-8000-000000000030', '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000020', 3, now() + interval '10 min'),
  ('00000000-0000-4000-8000-000000000031', '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000022', 1, now() + interval '10 min');

INSERT INTO orders.orders (id, event_id, hold_id, contact_email, access_token_hash, pay_code, amount_crc, status, idem_key, expires_at, paid_at) VALUES
  ('00000000-0000-4000-8000-000000000040', '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000030', 'buyer@example.com', sha256('tok1'), 'FEET01', 21417, 'paid', 'idem-fee-totals-1', now() + interval '10 min', now()),
  ('00000000-0000-4000-8000-000000000041', '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000031', 'free@example.com', sha256('tok2'), 'FEET02', 0, 'paid', 'idem-fee-totals-2', now() + interval '10 min', now());

INSERT INTO orders.order_items (order_id, ticket_type_id, quantity, unit_price_crc, unit_fee_crc, unit_fee_tax_crc, fee_rule) VALUES
  ('00000000-0000-4000-8000-000000000040', '00000000-0000-4000-8000-000000000020', 2, 5000, 350, 46, 'standard_v1'),
  ('00000000-0000-4000-8000-000000000040', '00000000-0000-4000-8000-000000000021', 1, 10000, 550, 72, 'standard_v1'),
  ('00000000-0000-4000-8000-000000000041', '00000000-0000-4000-8000-000000000022', 1, 0, 0, 0, 'free');

-- ── 1. Privileges ────────────────────────────────────────────────────────────
SELECT ok(
  NOT has_function_privilege('public', 'orders.order_fee_totals(uuid)', 'EXECUTE'),
  'PUBLIC cannot execute orders.order_fee_totals'
);
SELECT ok(
  NOT has_function_privilege('passripple_api', 'orders.order_fee_totals(uuid)', 'EXECUTE'),
  'passripple_api cannot execute orders.order_fee_totals'
);
SELECT ok(
  has_function_privilege('passripple_owner_settlement', 'orders.order_fee_totals(uuid)', 'EXECUTE'),
  'passripple_owner_settlement can execute orders.order_fee_totals'
);

SET LOCAL SESSION AUTHORIZATION passripple_api;
SELECT throws_ok(
  $$ SELECT * FROM orders.order_fee_totals('00000000-0000-4000-8000-000000000040') $$,
  '42501', NULL, 'API role calling orders.order_fee_totals is rejected'
);
RESET SESSION AUTHORIZATION;

-- ── 2. Settlement module role queries ────────────────────────────────────────
SET LOCAL ROLE passripple_owner_settlement;

SELECT is(
  (SELECT ROW(event_id, status, amount_crc, fee_crc, fee_tax_crc)
     FROM orders.order_fee_totals('00000000-0000-4000-8000-000000000040')),
  ROW('00000000-0000-4000-8000-000000000010'::uuid, 'paid'::text, 21417, 1250, 164),
  'order_fee_totals sums unit_fee_crc * quantity and unit_fee_tax_crc * quantity across order items'
);

SELECT is(
  (SELECT ROW(event_id, status, amount_crc, fee_crc, fee_tax_crc)
     FROM orders.order_fee_totals('00000000-0000-4000-8000-000000000041')),
  ROW('00000000-0000-4000-8000-000000000010'::uuid, 'paid'::text, 0, 0, 0),
  'order_fee_totals returns zero fees for a zero-fee order'
);

SELECT is(
  (SELECT count(*)::int FROM orders.order_fee_totals('00000000-0000-4000-8000-000000000099')),
  0,
  'order_fee_totals returns no rows for an unknown order'
);

RESET ROLE;

SELECT * FROM finish(true);
ROLLBACK;
