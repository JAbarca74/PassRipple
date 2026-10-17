BEGIN;
SELECT plan(15);

-- ── Superuser setup ──────────────────────────────────────────────────────────
INSERT INTO identity.organizations (id, name, verified_at) VALUES
  ('00000000-0000-4000-8000-00000000000a', 'Org 1', now()),
  ('00000000-0000-4000-8000-00000000000b', 'Org 2', now());

INSERT INTO identity.users (id, is_admin) VALUES
  ('00000000-0000-4000-8000-00000000000c', false),
  ('00000000-0000-4000-8000-00000000000d', false);

INSERT INTO identity.memberships (org_id, user_id) VALUES
  ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000c'),
  ('00000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-00000000000d');

INSERT INTO jurisdictions.jurisdictions (canton_code, name, tax_rate_bps, courtesy_deduct_bps, settlement_rule) VALUES
  ('TEST-01', 'Test', 0, '{}', 'next_business_day');

INSERT INTO events.events (id, org_id, canton_code, name, venue_name, starts_at, age_rating, permitted_capacity, status, published_at) VALUES
  ('00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-00000000000a', 'TEST-01', 'Event 1', 'Venue', now(), 'all', 10, 'on_sale', now()),
  ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-00000000000b', 'TEST-01', 'Event 2', 'Venue', now(), 'all', 10, 'on_sale', now());

INSERT INTO catalog.ticket_types (id, event_id, name, price_crc, audience) VALUES
  ('00000000-0000-4000-8000-000000000020', '00000000-0000-4000-8000-000000000010', 'Public 1', 1000, 'public'),
  ('00000000-0000-4000-8000-000000000021', '00000000-0000-4000-8000-000000000011', 'Public 2', 1000, 'public');

INSERT INTO inventory.event_capacity (event_id, permitted_capacity, committed) VALUES
  ('00000000-0000-4000-8000-000000000010', 10, 2),
  ('00000000-0000-4000-8000-000000000011', 10, 2);

-- Holds: h1 and h2 are valid, h3 is expired
INSERT INTO inventory.holds (id, event_id, ticket_type_id, quantity, expires_at) VALUES
  ('00000000-0000-4000-8000-000000000030', '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000020', 1, now() + interval '10 min'),
  ('00000000-0000-4000-8000-000000000031', '00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000021', 1, now() + interval '10 min'),
  ('00000000-0000-4000-8000-000000000032', '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000020', 1, now() + interval '10 min');
UPDATE inventory.holds SET ended_at = now(), end_reason = 'expired' WHERE id = '00000000-0000-4000-8000-000000000032';

-- Order
INSERT INTO orders.orders (id, event_id, hold_id, contact_email, access_token_hash, pay_code, amount_crc, idem_key, expires_at) VALUES
  ('00000000-0000-4000-8000-000000000040', '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000030', 'a@a.com', sha256(convert_to('12345678901234567890123456789012', 'UTF8')), 'CODE12', 1000, 'idemkey1', now() + interval '10 min');

INSERT INTO orders.order_items (id, order_id, ticket_type_id, quantity, unit_price_crc, unit_fee_crc, unit_fee_tax_crc, fee_rule) VALUES
  ('00000000-0000-4000-8000-000000000050', '00000000-0000-4000-8000-000000000040', '00000000-0000-4000-8000-000000000020', 1, 1000, 0, 0, 'none');

-- ── API actions ──────────────────────────────────────────────────────────────
SET LOCAL SESSION AUTHORIZATION passripple_api;

SELECT identity.set_actor(NULL, 'buyer');

SELECT throws_ok(
  $$ UPDATE orders.order_items SET unit_price_crc = 0 WHERE id = '00000000-0000-4000-8000-000000000050' $$,
  '42501', NULL, 'API cannot UPDATE order_items'
);
SELECT throws_ok(
  $$ DELETE FROM orders.order_items WHERE id = '00000000-0000-4000-8000-000000000050' $$,
  '42501', NULL, 'API cannot DELETE order_items'
);

SELECT throws_ok(
  $$ UPDATE orders.orders SET amount_crc = 0 WHERE id = '00000000-0000-4000-8000-000000000040' $$,
  '42501', NULL, 'API cannot UPDATE amount_crc'
);

-- Superuser UPDATE tests
RESET SESSION AUTHORIZATION;
SELECT throws_ok(
  $$ UPDATE orders.orders SET contact_email = 'b@b.com' WHERE id = '00000000-0000-4000-8000-000000000040' $$,
  '23001', NULL, 'changing contact fails guard'
);
SELECT throws_ok(
  $$ UPDATE orders.orders SET hold_id = '00000000-0000-4000-8000-000000000031' WHERE id = '00000000-0000-4000-8000-000000000040' $$,
  '23001', NULL, 'changing hold fails guard'
);
SELECT throws_ok(
  $$ UPDATE orders.orders SET status = 'refunded' WHERE id = '00000000-0000-4000-8000-000000000040' $$,
  '23001', NULL, 'invalid state transition pending to refunded'
);
SET LOCAL SESSION AUTHORIZATION passripple_api;

SELECT identity.set_actor(NULL, 'buyer');

SELECT throws_ok(
  $$ SELECT orders.create('00000000-0000-4000-8000-000000000031', 'idemkey1', 'a@a.com', NULL, '12345678901234567890123456789012', 'C0DE13', 0, 0, 'none') $$,
  '23505', NULL, 'idem_key repeated for different hold fails'
);

SELECT throws_ok(
  $$ SELECT orders.create('00000000-0000-4000-8000-000000000032', 'idemkey4', 'a@a.com', NULL, '12345678901234567890123456789012', 'C0DE14', 0, 0, 'none') $$,
  '55000', NULL, 'create for ended hold fails'
);

SELECT throws_ok(
  $$ SELECT orders.create('00000000-0000-4000-8000-000000000031', 'idemkey5', 'a@a.com', NULL, 'short', 'C0DE15', 0, 0, 'none') $$,
  '22023', NULL, 'token must be 32 chars'
);

-- order_for_token
SELECT is(
  (SELECT count(*)::int FROM orders.order_for_token('12345678901234567890123456789012')),
  1,
  'order_for_token finds order with right token'
);
SELECT is(
  (SELECT count(*)::int FROM orders.order_for_token('1234567890123456789012345678901x')),
  0,
  'order_for_token returns nothing with wrong token'
);

-- organizer tests
SELECT identity.set_actor('00000000-0000-4000-8000-00000000000d', 'organizer', '00000000-0000-4000-8000-00000000000b');
SELECT is(
  (SELECT count(*)::int FROM orders.orders WHERE id = '00000000-0000-4000-8000-000000000040'),
  0,
  'organizer of org 2 cannot see order for org 1'
);

RESET SESSION AUTHORIZATION;

-- ── Owner actions ────────────────────────────────────────────────────────────
SET LOCAL ROLE passripple_owner_orders;
SELECT throws_ok(
  $$ UPDATE orders.order_items SET unit_price_crc = 0 WHERE id = '00000000-0000-4000-8000-000000000050' $$,
  '23001', NULL, 'owner cannot UPDATE order_items'
);
SELECT throws_ok(
  $$ DELETE FROM orders.order_items WHERE id = '00000000-0000-4000-8000-000000000050' $$,
  '23001', NULL, 'owner cannot DELETE order_items'
);
SELECT throws_ok(
  $$ TRUNCATE orders.order_items $$,
  '23001', NULL, 'owner cannot TRUNCATE order_items'
);
RESET ROLE;

SELECT * FROM finish(true);
ROLLBACK;
