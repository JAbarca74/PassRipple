BEGIN;
SELECT plan(16);

-- ── Superuser setup: an event of 10 seats, 3 already committed online ───────
INSERT INTO identity.organizations (id, name, verified_at) VALUES
  ('00000000-0000-4000-8000-00000000000a', 'Org 1', now());
INSERT INTO identity.users (id, is_admin) VALUES
  ('00000000-0000-4000-8000-00000000000b', false),
  ('00000000-0000-4000-8000-00000000000c', false);
INSERT INTO jurisdictions.jurisdictions (canton_code, name, tax_rate_bps, courtesy_deduct_bps, settlement_rule) VALUES
  ('TEST-01', 'Test', 0, '{}', 'next_business_day');
INSERT INTO events.events (id, org_id, canton_code, name, venue_name, starts_at, age_rating, permitted_capacity, status, published_at) VALUES
  ('00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-00000000000a', 'TEST-01', 'Door', 'Venue', now(), 'all', 10, 'on_sale', now());
INSERT INTO catalog.ticket_types (id, event_id, name, price_crc, audience, entry_mode) VALUES
  ('00000000-0000-4000-8000-000000000020', '00000000-0000-4000-8000-000000000010', 'Puerta', 5000, 'public', 'single_use');
INSERT INTO inventory.event_capacity (event_id, permitted_capacity, committed) VALUES
  ('00000000-0000-4000-8000-000000000010', 10, 3);
INSERT INTO staff.staff_devices (id, event_id, user_id, role, valid_from, valid_until) VALUES
  ('00000000-0000-4000-8000-000000000030', '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-00000000000b', 'door_sales', now() - interval '1 day', now() + interval '1 day'),
  ('00000000-0000-4000-8000-000000000031', '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-00000000000c', 'door_sales', now() - interval '1 day', now() + interval '1 day');

-- ── 1. Assigning a block takes seats (I2) ────────────────────────────────────
SELECT identity.set_actor(NULL, 'system');
SELECT is(inventory.assign_block('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-000000000010',
          '00000000-0000-4000-8000-000000000020', '00000000-0000-4000-8000-000000000030', 4, 'door_sale'),
          true, 'a block of 4 fits in the 7 seats left');
SELECT is((SELECT committed FROM inventory.event_capacity WHERE event_id = '00000000-0000-4000-8000-000000000010'),
          7, 'the block went through the capacity counter');
SELECT is(inventory.assign_block('00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-000000000010',
          '00000000-0000-4000-8000-000000000020', '00000000-0000-4000-8000-000000000031', 4, 'door_sale'),
          false, 'a block that does not fit is refused, nothing taken');
SELECT is((SELECT count(*)::int FROM inventory.device_blocks), 1, 'the refused block was not recorded');
SELECT is(ticketing.issue_block('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-000000000010',
          '00000000-0000-4000-8000-000000000020', 'door_sale', ARRAY['D00R000001', 'D00R000002', 'D00R000003', 'D00R000004']),
          4, 'its tickets are pre-issued');
SELECT is((SELECT count(*)::int FROM ticketing.tickets WHERE block_id = '00000000-0000-4000-8000-0000000000b1' AND status = 'unsold'),
          4, 'all unsold until sold at the door');

CREATE TEMP TABLE block_codes AS
  SELECT code_human AS code, id FROM ticketing.tickets WHERE block_id IS NOT NULL;
GRANT SELECT ON block_codes TO passripple_api;

CREATE FUNCTION pg_temp.sale(p_id text, p_seq integer, p_code text, p_method text DEFAULT 'cash')
RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('id', p_id, 'deviceSeq', p_seq,
    'createdAt', floor(extract(epoch FROM now()) * 1000), 'clockOffsetMs', 0,
    'payload', jsonb_build_object('ticketId', (SELECT id FROM block_codes WHERE code = p_code),
                                  'method', p_method, 'amountCrc', 5000))
$$;
GRANT EXECUTE ON FUNCTION pg_temp.sale(text, integer, text, text) TO passripple_api;

-- ── 2. Selling at the door ───────────────────────────────────────────────────
SET LOCAL SESSION AUTHORIZATION passripple_api;
SELECT identity.set_actor('00000000-0000-4000-8000-00000000000b', 'staff');
SELECT is(
  door_sales.apply_sales('00000000-0000-4000-8000-000000000030', jsonb_build_array(
    pg_temp.sale('01900000-0000-7000-8000-000000000001', 1, 'D00R000001'),
    pg_temp.sale('01900000-0000-7000-8000-000000000002', 2, 'D00R000002', 'sinpe'))),
  '[{"id": "01900000-0000-7000-8000-000000000001", "status": "applied"},
    {"id": "01900000-0000-7000-8000-000000000002", "status": "applied"}]'::jsonb,
  'two sales from the block are applied');
SELECT is(
  door_sales.apply_sales('00000000-0000-4000-8000-000000000030', jsonb_build_array(
    pg_temp.sale('01900000-0000-7000-8000-000000000001', 1, 'D00R000001'))),
  '[{"id": "01900000-0000-7000-8000-000000000001", "status": "duplicate"}]'::jsonb,
  'the same sale synced twice is a duplicate');
SELECT is(
  (door_sales.apply_sales('00000000-0000-4000-8000-000000000030', jsonb_build_array(
    pg_temp.sale('01900000-0000-7000-8000-000000000003', 3, 'D00R000001')))->0->>'status'),
  'rejected', 'a second, different sale of a sold ticket is refused');
SELECT throws_ok(
  $$SELECT door_sales.apply_sales('00000000-0000-4000-8000-000000000031', jsonb_build_array(
      pg_temp.sale('01900000-0000-7000-8000-000000000004', 1, 'D00R000003')))$$,
  '42501', NULL, 'nobody uploads for another staff member''s device');
SELECT identity.set_actor('00000000-0000-4000-8000-00000000000c', 'staff');
SELECT is(
  (door_sales.apply_sales('00000000-0000-4000-8000-000000000031', jsonb_build_array(
    pg_temp.sale('01900000-0000-7000-8000-000000000005', 1, 'D00R000003')))->0->>'status'),
  'rejected', 'a device cannot sell from another device''s block');

RESET SESSION AUTHORIZATION;
SELECT results_eq(
  $$SELECT code_human, status FROM ticketing.tickets WHERE block_id IS NOT NULL ORDER BY code_human$$,
  $$VALUES ('D00R000001', 'issued'), ('D00R000002', 'issued'), ('D00R000003', 'unsold'), ('D00R000004', 'unsold')$$,
  'sold tickets are issued, the rest stay unsold');
SELECT is((SELECT sum(amount_crc)::int FROM door_sales.sales), 10000, 'what the organizer collected is recorded');
SELECT throws_ok($$UPDATE door_sales.sales SET amount_crc = 0$$, NULL, NULL, 'sales are append-only');

-- ── 3. Closing gives the unused seats back ───────────────────────────────────
SELECT identity.set_actor(NULL, 'system');
SELECT inventory.close_block('00000000-0000-4000-8000-0000000000b1',
                             ticketing.void_unsold('00000000-0000-4000-8000-0000000000b1'));
SELECT is((SELECT committed FROM inventory.event_capacity WHERE event_id = '00000000-0000-4000-8000-000000000010'),
          5, 'the 2 unsold seats went back: 3 online + 2 sold at the door');
SELECT throws_ok(
  $$SELECT inventory.close_block('00000000-0000-4000-8000-0000000000b1', 0)$$,
  '55000', NULL, 'a block closes once');

SELECT * FROM finish();
ROLLBACK;
