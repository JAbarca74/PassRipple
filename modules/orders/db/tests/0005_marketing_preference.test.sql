BEGIN;
SELECT plan(19);

-- ── Superuser setup ──────────────────────────────────────────────────────────
INSERT INTO identity.organizations (id, name, verified_at) VALUES
  ('00000000-0000-4000-8000-00000000000a', 'Org 1', now());

INSERT INTO jurisdictions.jurisdictions (canton_code, name, tax_rate_bps, courtesy_deduct_bps, settlement_rule) VALUES
  ('TEST-01', 'Test', 0, '{}', 'next_business_day');

INSERT INTO events.events (id, org_id, canton_code, name, venue_name, starts_at, ends_at, age_rating, permitted_capacity, status, published_at) VALUES
  ('00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-00000000000a', 'TEST-01', 'Marketing Event', 'Main Arena', now() + interval '1 day', now() + interval '2 days', 'all', 100, 'on_sale', now());

INSERT INTO catalog.ticket_types (id, event_id, name, price_crc, audience, entry_mode) VALUES
  ('00000000-0000-4000-8000-000000000020', '00000000-0000-4000-8000-000000000010', 'General', 5000, 'public', 'single_use');

INSERT INTO inventory.event_capacity (event_id, permitted_capacity, committed) VALUES
  ('00000000-0000-4000-8000-000000000010', 100, 0);

CREATE TEMPORARY TABLE test_data (
  name text PRIMARY KEY,
  id   uuid NOT NULL
);

GRANT SELECT ON test_data TO passripple_api;

-- ── Place orders as buyer ────────────────────────────────────────────────────
SELECT set_config('app.actor_role', 'buyer', true);
SELECT set_config('app.actor_id', '', true);

-- Two orders for a@example.com (tokens T1, T2)
INSERT INTO test_data (name, id)
VALUES ('hold_a1', inventory.hold(
  '00000000-0000-4000-8000-000000000010',
  '00000000-0000-4000-8000-000000000020',
  1
));

INSERT INTO test_data (name, id)
SELECT 'order_a1', order_id
  FROM orders.place(
    (SELECT id FROM test_data WHERE name = 'hold_a1'),
    'idem_mkt_a1',
    'a@example.com',
    NULL,
    '11111111111111111111111111111111',
    '{BUYER01}'::text[],
    500,
    65,
    'standard_v1',
    0
  );

INSERT INTO test_data (name, id)
VALUES ('hold_a2', inventory.hold(
  '00000000-0000-4000-8000-000000000010',
  '00000000-0000-4000-8000-000000000020',
  1
));

INSERT INTO test_data (name, id)
SELECT 'order_a2', order_id
  FROM orders.place(
    (SELECT id FROM test_data WHERE name = 'hold_a2'),
    'idem_mkt_a2',
    'a@example.com',
    NULL,
    '22222222222222222222222222222222',
    '{BUYER02}'::text[],
    500,
    65,
    'standard_v1',
    0
  );

-- One order for b@example.com (token T3)
INSERT INTO test_data (name, id)
VALUES ('hold_b', inventory.hold(
  '00000000-0000-4000-8000-000000000010',
  '00000000-0000-4000-8000-000000000020',
  1
));

INSERT INTO test_data (name, id)
SELECT 'order_b', order_id
  FROM orders.place(
    (SELECT id FROM test_data WHERE name = 'hold_b'),
    'idem_mkt_b',
    'b@example.com',
    NULL,
    '33333333333333333333333333333333',
    '{BUYER03}'::text[],
    500,
    65,
    'standard_v1',
    0
  );

-- Two phone-only orders for +50688887777 (tokens T4, T5)
INSERT INTO test_data (name, id)
VALUES ('hold_p1', inventory.hold(
  '00000000-0000-4000-8000-000000000010',
  '00000000-0000-4000-8000-000000000020',
  1
));

INSERT INTO test_data (name, id)
SELECT 'order_p1', order_id
  FROM orders.place(
    (SELECT id FROM test_data WHERE name = 'hold_p1'),
    'idem_mkt_p1',
    NULL,
    '+50688887777',
    '44444444444444444444444444444444',
    '{BUYER04}'::text[],
    500,
    65,
    'standard_v1',
    0
  );

INSERT INTO test_data (name, id)
VALUES ('hold_p2', inventory.hold(
  '00000000-0000-4000-8000-000000000010',
  '00000000-0000-4000-8000-000000000020',
  1
));

INSERT INTO test_data (name, id)
SELECT 'order_p2', order_id
  FROM orders.place(
    (SELECT id FROM test_data WHERE name = 'hold_p2'),
    'idem_mkt_p2',
    NULL,
    '+50688887777',
    '55555555555555555555555555555555',
    '{BUYER05}'::text[],
    500,
    65,
    'standard_v1',
    0
  );

-- One order with email c@example.com AND phone +50688887777 (token T6)
INSERT INTO test_data (name, id)
VALUES ('hold_c', inventory.hold(
  '00000000-0000-4000-8000-000000000010',
  '00000000-0000-4000-8000-000000000020',
  1
));

INSERT INTO test_data (name, id)
SELECT 'order_c', order_id
  FROM orders.place(
    (SELECT id FROM test_data WHERE name = 'hold_c'),
    'idem_mkt_c',
    'c@example.com',
    '+50688887777',
    '66666666666666666666666666666666',
    '{BUYER06}'::text[],
    500,
    65,
    'standard_v1',
    0
  );

-- ── 1. Privileges ────────────────────────────────────────────────────────────
SELECT ok(
  has_function_privilege('passripple_api', 'orders.contact_orders(text)', 'EXECUTE'),
  'orders.contact_orders is executable by passripple_api'
);

SELECT ok(
  has_function_privilege('passripple_api', 'orders.marketing_preference(text)', 'EXECUTE'),
  'orders.marketing_preference is executable by passripple_api'
);

-- ── 2. contact_orders matching rules ─────────────────────────────────────────
SELECT is(
  ARRAY(SELECT order_id FROM orders.contact_orders('11111111111111111111111111111111') ORDER BY order_id),
  ARRAY(SELECT id FROM test_data WHERE name IN ('order_a1', 'order_a2') ORDER BY id),
  'contact_orders(T1) returns exactly the two a@example.com orders'
);

SELECT is(
  ARRAY(SELECT order_id FROM orders.contact_orders('33333333333333333333333333333333')),
  ARRAY[(SELECT id FROM test_data WHERE name = 'order_b')],
  'contact_orders(T3) returns only b@example.com order'
);

SELECT is(
  ARRAY(SELECT order_id FROM orders.contact_orders('44444444444444444444444444444444') ORDER BY order_id),
  ARRAY(SELECT id FROM test_data WHERE name IN ('order_p1', 'order_p2') ORDER BY id),
  'contact_orders(T4) returns phone-only orders T4 and T5 but not T6 (which has an email)'
);

SELECT is(
  ARRAY(SELECT order_id FROM orders.contact_orders('66666666666666666666666666666666')),
  ARRAY[(SELECT id FROM test_data WHERE name = 'order_c')],
  'contact_orders(T6) matches by email c@example.com and excludes phone-only orders'
);

SELECT is(
  ARRAY(SELECT order_id FROM orders.contact_orders('99999999999999999999999999999999')),
  '{}'::uuid[],
  'contact_orders with unknown token returns no rows'
);

-- ── 3. marketing_preference resolution ───────────────────────────────────────
SELECT is(
  orders.marketing_preference('11111111111111111111111111111111'),
  NULL::boolean,
  'marketing_preference(T1) is NULL when no marketing consent exists'
);

SELECT is(
  orders.marketing_preference('99999999999999999999999999999999'),
  NULL::boolean,
  'marketing_preference with unknown token is NULL'
);

-- Non-marketing consent does not count
SELECT privacy.record_consent(
  (SELECT id FROM test_data WHERE name = 'order_a1'),
  'terms',
  true,
  'v1',
  'checkout'
);

SELECT is(
  orders.marketing_preference('11111111111111111111111111111111'),
  NULL::boolean,
  'non-marketing consent (terms) does not affect marketing_preference'
);

-- Recording marketing consent via privacy.record_consent
SELECT privacy.record_consent(
  (SELECT id FROM test_data WHERE name = 'order_b'),
  'marketing',
  true,
  'v1',
  'checkout'
);

SELECT is(
  orders.marketing_preference('33333333333333333333333333333333'),
  true,
  'marketing_preference(T3) returns recorded value after privacy.record_consent'
);

SELECT is(
  orders.marketing_preference('11111111111111111111111111111111'),
  NULL::boolean,
  'b@example.com consents do not affect a@example.com'
);

-- Newest consent wins across orders of the same contact
INSERT INTO privacy.consents (subject_id, purpose, granted, document_version, source, created_at)
VALUES (
  (SELECT id FROM test_data WHERE name = 'order_a1'),
  'marketing',
  true,
  'v1',
  'checkout',
  now() - interval '1 hour'
);

SELECT is(
  orders.marketing_preference('11111111111111111111111111111111'),
  true,
  'marketing_preference(T1) returns true after older consent on order A1'
);

INSERT INTO privacy.consents (subject_id, purpose, granted, document_version, source, created_at)
VALUES (
  (SELECT id FROM test_data WHERE name = 'order_a2'),
  'marketing',
  false,
  'v1',
  'wallet',
  now()
);

SELECT is(
  orders.marketing_preference('11111111111111111111111111111111'),
  false,
  'marketing_preference(T1) returns false when newer consent on order A2 is false'
);

SELECT is(
  orders.marketing_preference('22222222222222222222222222222222'),
  false,
  'marketing_preference(T2) also returns false for the same contact'
);

SELECT is(
  orders.marketing_preference('33333333333333333333333333333333'),
  true,
  'a@example.com consents do not affect b@example.com'
);

-- ── 4. Erasure clears token and contact ──────────────────────────────────────
SELECT set_config('app.actor_role', 'system', true);

SELECT orders.mark_paid((SELECT id FROM test_data WHERE name = 'order_a1'));
SELECT orders.mark_paid((SELECT id FROM test_data WHERE name = 'order_a2'));

UPDATE events.events
   SET starts_at = now() - interval '2 days',
       ends_at = now() - interval '1 day'
 WHERE id = '00000000-0000-4000-8000-000000000010';

SELECT orders.request_contact_code(
  'a@example.com',
  'erasure',
  decode('0404040404040404040404040404040404040404040404040404040404040404', 'hex'),
  interval '10 minutes'
);
INSERT INTO test_data (name, id)
SELECT 'used_erasure_code', code_id
  FROM orders.contact_code_challenge('a@example.com', 'erasure');
SELECT orders.use_contact_code((SELECT id FROM test_data WHERE name = 'used_erasure_code'));

SELECT is(
  orders.erase_buyer((SELECT id FROM test_data WHERE name = 'used_erasure_code')),
  2,
  'orders.erase_buyer erases both a@example.com orders'
);

SELECT is(
  ARRAY(SELECT order_id FROM orders.contact_orders('11111111111111111111111111111111')),
  '{}'::uuid[],
  'contact_orders(T1) returns nothing after orders.erase_buyer'
);

SELECT is(
  orders.marketing_preference('11111111111111111111111111111111'),
  NULL::boolean,
  'marketing_preference(T1) returns NULL after orders.erase_buyer'
);

SELECT * FROM finish();
ROLLBACK;
