BEGIN;
SELECT plan(9);

-- ── Superuser setup: event 10 has ₡10.000 online, event 11 nothing ──────────
INSERT INTO identity.organizations (id, name, verified_at) VALUES
  ('00000000-0000-4000-8000-00000000000a', 'Org 1', now());
INSERT INTO jurisdictions.jurisdictions (canton_code, name, tax_rate_bps, courtesy_deduct_bps, settlement_rule) VALUES
  ('TEST-01', 'Test', 0, '{}', 'next_business_day');
INSERT INTO events.events (id, org_id, canton_code, name, venue_name, starts_at, age_rating, permitted_capacity, status, published_at) VALUES
  ('00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-00000000000a', 'TEST-01', 'Mixed', 'Venue', now(), 'all', 100, 'on_sale', now()),
  ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-00000000000a', 'TEST-01', 'Door only', 'Venue', now(), 'all', 100, 'on_sale', now());
INSERT INTO settlement.ledger_entries (event_id, kind, amount_crc) VALUES
  ('00000000-0000-4000-8000-000000000010', 'payment_in', 10000);

SELECT identity.set_actor(NULL, 'system');

SELECT is(settlement.record_door_sale('01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-000000000010', 5000, 350, 46),
          'recorded', 'a door sale and its commission are recorded');
SELECT results_eq(
  $$SELECT kind, amount_crc FROM settlement.ledger_entries
     WHERE reference = 'door:01900000-0000-7000-8000-000000000001' ORDER BY kind$$,
  $$VALUES ('door_sale', 5000), ('fee', -350), ('fee_tax', -46)$$,
  'the sale is collected by the organizer, the commission comes off the online balance');
SELECT is((SELECT sum(amount_crc)::int FROM settlement.ledger_entries
            WHERE event_id = '00000000-0000-4000-8000-000000000010' AND kind <> 'door_sale'),
          10000 - 350 - 46, 'the door money is not in the balance; its commission is');
SELECT is(settlement.record_door_sale('01900000-0000-7000-8000-000000000001', '00000000-0000-4000-8000-000000000010', 5000, 350, 46),
          'duplicate', 'the same sale recorded twice is a duplicate');
SELECT is((SELECT count(*)::int FROM settlement.ledger_entries WHERE reference LIKE 'door:%'),
          3, 'nothing was recorded twice');

SELECT is(settlement.record_door_sale('01900000-0000-7000-8000-000000000002', '00000000-0000-4000-8000-000000000011', 5000, 350, 46),
          'recorded', 'a door-only event still gets its commission');
SELECT is((SELECT sum(amount_crc)::int FROM settlement.ledger_entries
            WHERE event_id = '00000000-0000-4000-8000-000000000011' AND kind <> 'door_sale'),
          -396, 'its balance is what the organizer owes the platform');
SELECT throws_ok(
  $$SELECT settlement.record_entry('00000000-0000-4000-8000-000000000011', 'payout', -1, 'x', NULL)$$,
  '23514', NULL, 'and no payout goes out while it is owed (I9)');

SELECT set_config('app.actor_role', 'organizer', true);
SELECT throws_ok(
  $$SELECT settlement.record_door_sale('01900000-0000-7000-8000-000000000003', '00000000-0000-4000-8000-000000000010', 1, 0, 0)$$,
  '42501', NULL, 'only the system records door sales');

SELECT * FROM finish();
ROLLBACK;
