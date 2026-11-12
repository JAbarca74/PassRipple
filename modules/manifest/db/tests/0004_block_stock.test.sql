BEGIN;
SELECT plan(4);

-- ── Superuser setup: one sold ticket and a block of two for door-sales device 30 ──
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
  ('00000000-0000-4000-8000-000000000020', '00000000-0000-4000-8000-000000000010', 'General', 5000, 'public', 'single_use');
INSERT INTO inventory.event_capacity (event_id, permitted_capacity, committed) VALUES
  ('00000000-0000-4000-8000-000000000010', 10, 1);
INSERT INTO ticketing.tickets (id, event_id, ticket_type_id, origin, code_human) VALUES
  ('00000000-0000-4000-8000-000000000040', '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000020', 'courtesy', 'C0DE400000');
INSERT INTO staff.staff_devices (id, event_id, user_id, role, valid_from, valid_until) VALUES
  ('00000000-0000-4000-8000-000000000030', '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-00000000000b', 'door_sales', now() - interval '1 day', now() + interval '1 day'),
  ('00000000-0000-4000-8000-000000000031', '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-00000000000c', 'gate', now() - interval '1 day', now() + interval '1 day');

SELECT identity.set_actor(NULL, 'system');
SELECT inventory.assign_block('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-000000000010',
       '00000000-0000-4000-8000-000000000020', '00000000-0000-4000-8000-000000000030', 2, 'door_sale');
SELECT ticketing.issue_block('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-000000000010',
       '00000000-0000-4000-8000-000000000020', 'door_sale', ARRAY['D00R000001', 'D00R000002']);

SET LOCAL SESSION AUTHORIZATION passripple_api;
SELECT identity.set_actor('00000000-0000-4000-8000-00000000000b', 'staff');
SELECT results_eq(
  $$SELECT code_human, status FROM manifest.gate_tickets('00000000-0000-4000-8000-000000000030') ORDER BY code_human$$,
  $$VALUES ('C0DE400000', 'issued'), ('D00R000001', 'unsold'), ('D00R000002', 'unsold')$$,
  'the door-sales device gets its own block''s unsold tickets');

SELECT identity.set_actor('00000000-0000-4000-8000-00000000000c', 'staff');
SELECT results_eq(
  $$SELECT code_human FROM manifest.gate_tickets('00000000-0000-4000-8000-000000000031')$$,
  $$VALUES ('C0DE400000')$$,
  'another device never sees unsold stock');

RESET SESSION AUTHORIZATION;
SELECT identity.set_actor(NULL, 'system');
SELECT inventory.close_block('00000000-0000-4000-8000-0000000000b1',
                             ticketing.void_unsold('00000000-0000-4000-8000-0000000000b1'));
SET LOCAL SESSION AUTHORIZATION passripple_api;
SELECT identity.set_actor('00000000-0000-4000-8000-00000000000b', 'staff');
SELECT results_eq(
  $$SELECT code_human, status FROM manifest.gate_tickets('00000000-0000-4000-8000-000000000030') ORDER BY code_human$$,
  $$VALUES ('C0DE400000', 'issued'), ('D00R000001', 'void'), ('D00R000002', 'void')$$,
  'a closed block''s tickets reach the device as void');
SELECT identity.set_actor('00000000-0000-4000-8000-00000000000c', 'staff');
SELECT is((SELECT count(*)::int FROM manifest.gate_tickets('00000000-0000-4000-8000-000000000031')),
          3, 'void tickets reach every device, so none is admitted');

SELECT * FROM finish();
ROLLBACK;
