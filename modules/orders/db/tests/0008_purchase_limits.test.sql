-- Design 9.3, point 5: the event's tickets per order (on the hold) and unpaid orders per
-- buyer (on the order).
BEGIN;
SELECT plan(6);

-- ── Superuser setup ──────────────────────────────────────────────────────────
INSERT INTO identity.organizations (id, name, verified_at) VALUES
  ('00000000-0000-4000-8000-0000000009a1', 'Org', now());
INSERT INTO jurisdictions.jurisdictions (canton_code, name, tax_rate_bps, courtesy_deduct_bps, settlement_rule)
  VALUES ('TEST-09', 'Test', 0, '{}', 'next_business_day');
INSERT INTO events.events (id, org_id, canton_code, name, venue_name, starts_at, age_rating, permitted_capacity, status, published_at, max_tickets_per_order, max_open_orders_per_buyer)
  VALUES ('00000000-0000-4000-8000-0000000009e1', '00000000-0000-4000-8000-0000000009a1', 'TEST-09', 'E', 'V',
          now() + interval '5 days', 'all', 100, 'on_sale', now(), 4, 2);
INSERT INTO inventory.event_capacity (event_id, permitted_capacity) VALUES ('00000000-0000-4000-8000-0000000009e1', 100);
INSERT INTO catalog.ticket_types (id, event_id, name, price_crc, audience)
  VALUES ('00000000-0000-4000-8000-0000000009f1', '00000000-0000-4000-8000-0000000009e1', 'General', 5000, 'public');

SET LOCAL SESSION AUTHORIZATION passripple_api;
SELECT identity.set_actor(NULL, 'buyer');

-- ── Tickets per order ───────────────────────────────────────────────────────
SELECT throws_ok(
  $$ SELECT inventory.hold('00000000-0000-4000-8000-0000000009e1', '00000000-0000-4000-8000-0000000009f1', 5) $$,
  'PR413', NULL, 'a hold above the event''s tickets per order is refused'
);
SELECT isnt(
  inventory.hold('00000000-0000-4000-8000-0000000009e1', '00000000-0000-4000-8000-0000000009f1', 4),
  NULL, 'a hold of exactly the limit is accepted'
);

-- ── Unpaid orders per buyer ─────────────────────────────────────────────────
CREATE FUNCTION pg_temp.place(p_key text, p_email text, p_phone text) RETURNS uuid
LANGUAGE sql AS $f$
  SELECT order_id FROM orders.place(
    inventory.hold('00000000-0000-4000-8000-0000000009e1', '00000000-0000-4000-8000-0000000009f1', 1),
    p_key, p_email, p_phone, repeat('t', 32) || p_key, ARRAY['A1B2C', 'D3E4F', 'G5H6J'],
    0, 0, 'test', 0)
$f$;

SELECT isnt(pg_temp.place('idem-key-1', 'Buyer@Example.com', NULL), NULL, 'first unpaid order');
SELECT isnt(pg_temp.place('idem-key-2', 'buyer@example.com', NULL), NULL, 'second unpaid order, same email in another case');
SELECT throws_ok(
  $$ SELECT pg_temp.place('idem-key-3', 'BUYER@example.com', NULL) $$,
  'PRBUY', NULL, 'a third unpaid order of the same email is refused'
);
SELECT isnt(pg_temp.place('idem-key-4', 'other@example.com', NULL), NULL, 'another buyer is not affected');

SELECT * FROM finish();
ROLLBACK;
