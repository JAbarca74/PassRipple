BEGIN;
SELECT plan(27);

-- ── Superuser setup ──────────────────────────────────────────────────────────
INSERT INTO identity.organizations (id, name, verified_at) VALUES
  ('00000000-0000-4000-8000-00000000000a', 'Org 1', now());
INSERT INTO jurisdictions.jurisdictions (canton_code, name, tax_rate_bps, courtesy_deduct_bps, settlement_rule) VALUES
  ('TEST-01', 'Test', 0, '{}', 'next_business_day');
INSERT INTO events.events (id, org_id, canton_code, name, venue_name, starts_at, age_rating, permitted_capacity, status, published_at) VALUES
  ('00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-00000000000a', 'TEST-01', 'Event 1', 'Venue', now() + interval '1 day', 'all', 10, 'on_sale', now());

INSERT INTO catalog.ticket_types (id, event_id, name, price_crc, audience, entry_mode) VALUES
  ('00000000-0000-4000-8000-000000000020', '00000000-0000-4000-8000-000000000010', 'Free Ticket', 0, 'public', 'single_use'),
  ('00000000-0000-4000-8000-000000000021', '00000000-0000-4000-8000-000000000010', 'Paid Ticket', 1000, 'public', 'single_use');

INSERT INTO inventory.event_capacity (event_id, permitted_capacity, committed) VALUES
  ('00000000-0000-4000-8000-000000000010', 10, 0);

CREATE TEMPORARY TABLE test_data (
  name text PRIMARY KEY,
  id   uuid NOT NULL
);

-- ── Create holds and orders as buyer ─────────────────────────────────────────
SELECT set_config('app.actor_role', 'buyer', true);

-- Free order hold & placement
INSERT INTO test_data (name, id)
VALUES ('free_hold', inventory.hold(
  '00000000-0000-4000-8000-000000000010',
  '00000000-0000-4000-8000-000000000020',
  1
));

INSERT INTO test_data (name, id)
SELECT 'free_order', order_id
  FROM orders.place(
    (SELECT id FROM test_data WHERE name = 'free_hold'),
    'idem_free_01',
    'free@example.com',
    NULL,
    '11111111111111111111111111111111',
    '{CODIGO01}'::text[],
    0,
    0,
    'regla',
    5
  );

-- Paid order hold & placement
INSERT INTO test_data (name, id)
VALUES ('paid_hold', inventory.hold(
  '00000000-0000-4000-8000-000000000010',
  '00000000-0000-4000-8000-000000000021',
  1
));

INSERT INTO test_data (name, id)
SELECT 'paid_order', order_id
  FROM orders.place(
    (SELECT id FROM test_data WHERE name = 'paid_hold'),
    'idem_paid_01',
    'paid@example.com',
    NULL,
    '22222222222222222222222222222222',
    '{CODIGO02}'::text[],
    0,
    0,
    'regla',
    5
  );

-- ── 1. Actor privilege: only buyer or system can settle ──────────────────────
SELECT set_config('app.actor_role', '', true);
SELECT throws_ok(
  $$ SELECT orders.settle_free((SELECT id FROM test_data WHERE name = 'free_order')) $$,
  '42501', NULL, 'actor without role cannot settle free order'
);

SELECT set_config('app.actor_role', 'organizer', true);
SELECT throws_ok(
  $$ SELECT orders.settle_free((SELECT id FROM test_data WHERE name = 'free_order')) $$,
  '42501', NULL, 'organizer cannot settle free order'
);

SELECT set_config('app.actor_role', 'admin', true);
SELECT throws_ok(
  $$ SELECT orders.settle_free((SELECT id FROM test_data WHERE name = 'free_order')) $$,
  '42501', NULL, 'admin cannot settle free order'
);

SELECT set_config('app.actor_role', 'staff', true);
SELECT throws_ok(
  $$ SELECT orders.settle_free((SELECT id FROM test_data WHERE name = 'free_order')) $$,
  '42501', NULL, 'staff cannot settle free order'
);

SELECT set_config('app.actor_role', 'inspector', true);
SELECT throws_ok(
  $$ SELECT orders.settle_free((SELECT id FROM test_data WHERE name = 'free_order')) $$,
  '42501', NULL, 'inspector cannot settle free order'
);

SELECT is(
  (SELECT count(*) FROM orders.outbox WHERE (payload->>'orderId')::uuid = (SELECT id FROM test_data WHERE name = 'free_order')),
  0::bigint,
  'no outbox event emitted on unauthorized settlement attempts'
);

-- ── 2. Inexistent order throws P0002 ─────────────────────────────────────────
SELECT set_config('app.actor_role', 'buyer', true);

SELECT throws_ok(
  $$ SELECT orders.settle_free('00000000-0000-4000-8000-000000000099'::uuid) $$,
  'P0002', NULL, 'nonexistent order throws no_data_found'
);

-- ── 3. Order with amount_crc <> 0 throws 55000 ───────────────────────────────
SELECT throws_ok(
  $$ SELECT orders.settle_free((SELECT id FROM test_data WHERE name = 'paid_order')) $$,
  '55000', NULL, 'order with positive amount throws object_not_in_prerequisite_state'
);

SELECT is(
  (SELECT count(*) FROM orders.outbox WHERE (payload->>'orderId')::uuid = (SELECT id FROM test_data WHERE name = 'paid_order')),
  0::bigint,
  'paid order has no outbox row'
);

-- ── 4. Pending ₡0 order settles successfully ─────────────────────────────────
SELECT is(
  (SELECT orders.settle_free((SELECT id FROM test_data WHERE name = 'free_order'))),
  'paid',
  'settle_free returns paid for pending 0 crc order'
);

SELECT is(
  (SELECT status FROM orders.orders WHERE id = (SELECT id FROM test_data WHERE name = 'free_order')),
  'paid',
  'free order status changed to paid'
);

SELECT ok(
  (SELECT paid_at IS NOT NULL FROM orders.orders WHERE id = (SELECT id FROM test_data WHERE name = 'free_order')),
  'free order paid_at is set'
);

SELECT is(
  (SELECT end_reason FROM inventory.holds WHERE id = (SELECT id FROM test_data WHERE name = 'free_hold')),
  'converted',
  'hold was converted'
);

SELECT ok(
  (SELECT ended_at IS NOT NULL FROM inventory.holds WHERE id = (SELECT id FROM test_data WHERE name = 'free_hold')),
  'hold ended_at is set'
);

SELECT is(
  (SELECT count(*) FROM orders.outbox WHERE (payload->>'orderId')::uuid = (SELECT id FROM test_data WHERE name = 'free_order')),
  1::bigint,
  'orders.outbox received 1 order.paid event'
);

SELECT is(
  (SELECT type FROM orders.outbox WHERE (payload->>'orderId')::uuid = (SELECT id FROM test_data WHERE name = 'free_order')),
  'order.paid',
  'outbox row type is order.paid'
);

SELECT is(
  (SELECT payload->>'type' FROM orders.outbox WHERE (payload->>'orderId')::uuid = (SELECT id FROM test_data WHERE name = 'free_order')),
  'order.paid',
  'payload type is order.paid'
);

SELECT is(
  (SELECT (payload->>'orderId')::uuid FROM orders.outbox WHERE (payload->>'orderId')::uuid = (SELECT id FROM test_data WHERE name = 'free_order')),
  (SELECT id FROM test_data WHERE name = 'free_order'),
  'payload orderId matches'
);

SELECT is(
  (SELECT (payload->>'eventId')::uuid FROM orders.outbox WHERE (payload->>'orderId')::uuid = (SELECT id FROM test_data WHERE name = 'free_order')),
  '00000000-0000-4000-8000-000000000010'::uuid,
  'payload eventId matches'
);

SELECT ok(
  (SELECT payload->>'occurredAt' IS NOT NULL FROM orders.outbox WHERE (payload->>'orderId')::uuid = (SELECT id FROM test_data WHERE name = 'free_order')),
  'payload occurredAt is not null'
);

-- ── 5. Second call on same order returns already_paid and emits nothing ──────
SELECT is(
  (SELECT orders.settle_free((SELECT id FROM test_data WHERE name = 'free_order'))),
  'already_paid',
  'second call on settled order returns already_paid'
);

SELECT is(
  (SELECT count(*) FROM orders.outbox WHERE (payload->>'orderId')::uuid = (SELECT id FROM test_data WHERE name = 'free_order')),
  1::bigint,
  'no additional outbox event emitted on already_paid order'
);

-- ── 6. System actor can also settle free orders ──────────────────────────────
INSERT INTO test_data (name, id)
VALUES ('free_hold_sys', inventory.hold(
  '00000000-0000-4000-8000-000000000010',
  '00000000-0000-4000-8000-000000000020',
  1
));

INSERT INTO test_data (name, id)
SELECT 'free_order_sys', order_id
  FROM orders.place(
    (SELECT id FROM test_data WHERE name = 'free_hold_sys'),
    'idem_free_sys_01',
    'freesys@example.com',
    NULL,
    '33333333333333333333333333333333',
    '{CODIGO03}'::text[],
    0,
    0,
    'regla',
    5
  );

SELECT set_config('app.actor_role', 'system', true);

SELECT is(
  (SELECT orders.settle_free((SELECT id FROM test_data WHERE name = 'free_order_sys'))),
  'paid',
  'system actor can settle free order'
);

SELECT is(
  (SELECT status FROM orders.orders WHERE id = (SELECT id FROM test_data WHERE name = 'free_order_sys')),
  'paid',
  'system settled free order status is paid'
);

SELECT is(
  (SELECT end_reason FROM inventory.holds WHERE id = (SELECT id FROM test_data WHERE name = 'free_hold_sys')),
  'converted',
  'system settled hold was converted'
);

SELECT is(
  (SELECT count(*) FROM orders.outbox WHERE (payload->>'orderId')::uuid = (SELECT id FROM test_data WHERE name = 'free_order_sys')),
  1::bigint,
  'system settled order emits 1 outbox event'
);

SELECT is(
  (SELECT type FROM orders.outbox WHERE (payload->>'orderId')::uuid = (SELECT id FROM test_data WHERE name = 'free_order_sys')),
  'order.paid',
  'system settled outbox row type is order.paid'
);

SELECT * FROM finish();
ROLLBACK;
