BEGIN;
SELECT plan(8);

-- ── Superuser setup ──────────────────────────────────────────────────────────
INSERT INTO identity.organizations (id, name, verified_at) VALUES
  ('00000000-0000-4000-8000-0000000007a1', 'Org A', now()),
  ('00000000-0000-4000-8000-0000000007a2', 'Org B', now());
INSERT INTO identity.users (id, is_admin) VALUES
  ('00000000-0000-4000-8000-0000000007b1', false),
  ('00000000-0000-4000-8000-0000000007b2', false),
  ('00000000-0000-4000-8000-0000000007b3', true),
  ('00000000-0000-4000-8000-0000000007b4', false);
INSERT INTO identity.memberships (org_id, user_id) VALUES
  ('00000000-0000-4000-8000-0000000007a1', '00000000-0000-4000-8000-0000000007b1'),
  ('00000000-0000-4000-8000-0000000007a2', '00000000-0000-4000-8000-0000000007b2');
INSERT INTO jurisdictions.jurisdictions (canton_code, name, tax_rate_bps, courtesy_deduct_bps, settlement_rule)
  VALUES ('TEST-07', 'Test', 0, '{}', 'next_business_day');
INSERT INTO events.events (id, org_id, canton_code, name, venue_name, starts_at, ends_at, age_rating, permitted_capacity, status, published_at)
  VALUES ('00000000-0000-4000-8000-0000000007e1', '00000000-0000-4000-8000-0000000007a1', 'TEST-07', 'Live', 'V',
          now() - interval '1 hour', now() + interval '3 hours', 'all', 50, 'on_sale', now() - interval '2 days');
INSERT INTO inventory.event_capacity (event_id, permitted_capacity, committed)
  VALUES ('00000000-0000-4000-8000-0000000007e1', 50, 6);
INSERT INTO catalog.ticket_types (id, event_id, name, price_crc, audience)
  VALUES ('00000000-0000-4000-8000-0000000007f1', '00000000-0000-4000-8000-0000000007e1', 'General', 5000, 'public');

-- 3 sold (one voided), 1 courtesy, 1 door sale, 1 unsold door block.
INSERT INTO ticketing.tickets (id, event_id, ticket_type_id, origin, code_human, entry_mode, status, order_id) VALUES
  ('00000000-0000-4000-8000-0000000007c1', '00000000-0000-4000-8000-0000000007e1', '00000000-0000-4000-8000-0000000007f1', 'sale', 'R7C1000000', 'single_use', 'issued', '00000000-0000-4000-8000-0000000007aa'),
  ('00000000-0000-4000-8000-0000000007c2', '00000000-0000-4000-8000-0000000007e1', '00000000-0000-4000-8000-0000000007f1', 'sale', 'R7C2000000', 'single_use', 'issued', '00000000-0000-4000-8000-0000000007aa'),
  ('00000000-0000-4000-8000-0000000007c3', '00000000-0000-4000-8000-0000000007e1', '00000000-0000-4000-8000-0000000007f1', 'sale', 'R7C3000000', 'single_use', 'void', '00000000-0000-4000-8000-0000000007aa'),
  ('00000000-0000-4000-8000-0000000007c4', '00000000-0000-4000-8000-0000000007e1', '00000000-0000-4000-8000-0000000007f1', 'courtesy', 'R7C4000000', 'single_use', 'issued', NULL),
  ('00000000-0000-4000-8000-0000000007c5', '00000000-0000-4000-8000-0000000007e1', '00000000-0000-4000-8000-0000000007f1', 'door_sale', 'R7C5000000', 'single_use', 'issued', NULL),
  ('00000000-0000-4000-8000-0000000007c6', '00000000-0000-4000-8000-0000000007e1', '00000000-0000-4000-8000-0000000007f1', 'door_sale', 'R7C6000000', 'single_use', 'unsold', NULL);

-- Two gate devices: one scanned, one never synced.
INSERT INTO staff.staff_devices (id, event_id, user_id, role, zone, valid_from, valid_until, created_at) VALUES
  ('00000000-0000-4000-8000-0000000007d1', '00000000-0000-4000-8000-0000000007e1', '00000000-0000-4000-8000-0000000007b4', 'gate', NULL, now() - interval '1 day', now() + interval '1 day', now() - interval '2 hours'),
  ('00000000-0000-4000-8000-0000000007d2', '00000000-0000-4000-8000-0000000007e1', '00000000-0000-4000-8000-0000000007b4', 'gate', 'VIP', now() - interval '1 day', now() + interval '1 day', now() - interval '1 hour');

-- Ticket c1 admitted then scanned again (duplicate); c4 admitted.
INSERT INTO redemption.redemptions (id, ticket_id, device_id, device_seq, scanned_at_device, method, entry_mode, outcome, synced_at) VALUES
  ('00000000-0000-4000-8000-000000000791', '00000000-0000-4000-8000-0000000007c1', '00000000-0000-4000-8000-0000000007d1', 1, now(), 'qr', 'single_use', 'admitted', now() - interval '10 minutes'),
  ('00000000-0000-4000-8000-000000000792', '00000000-0000-4000-8000-0000000007c1', '00000000-0000-4000-8000-0000000007d1', 2, now(), 'qr', 'single_use', 'duplicate', now() - interval '5 minutes'),
  ('00000000-0000-4000-8000-000000000793', '00000000-0000-4000-8000-0000000007c4', '00000000-0000-4000-8000-0000000007d1', 3, now(), 'manual', 'single_use', 'admitted', now() - interval '4 minutes');
INSERT INTO redemption.incidents (id, device_id, kind, source, device_seq, occurred_at_device, note, created_at) VALUES
  ('00000000-0000-4000-8000-000000000794', '00000000-0000-4000-8000-0000000007d1', 'operator', 'device', 4, now(), 'Puerta trabada', now() - interval '1 minute');

SET LOCAL SESSION AUTHORIZATION passripple_api;

SELECT identity.set_actor('00000000-0000-4000-8000-0000000007b1', 'organizer', '00000000-0000-4000-8000-0000000007a1');
SELECT results_eq(
  $$ SELECT permitted_capacity, committed, sold, courtesies, door_sales, admitted, duplicates, incidents
       FROM reporting.event_counters('00000000-0000-4000-8000-0000000007e1') $$,
  $$ VALUES (50, 6, 2, 1, 1, 2, 1, 1) $$,
  'counters leave out voided and unsold tickets and count each admitted ticket once'
);

SELECT is(
  (SELECT jsonb_array_length(sales_by_hour) FROM reporting.event_counters('00000000-0000-4000-8000-0000000007e1')),
  12, 'the hourly series always has 12 hours'
);

SELECT is(
  (SELECT (sales_by_hour -> 11 ->> 'tickets')::int FROM reporting.event_counters('00000000-0000-4000-8000-0000000007e1')),
  2, 'the current hour holds the 2 sold tickets that were not voided'
);

SELECT results_eq(
  $$ SELECT zone, admitted, incidents, last_sync_at > now() - interval '2 minutes'
       FROM reporting.event_devices('00000000-0000-4000-8000-0000000007e1') $$,
  $$ VALUES (NULL::text, 2, 1, true), ('VIP'::text, 0, 0, NULL::boolean) $$,
  'each device shows its admissions, incidents and last synchronization, enrolled first'
);

SELECT identity.set_actor('00000000-0000-4000-8000-0000000007b2', 'organizer', '00000000-0000-4000-8000-0000000007a2');
SELECT throws_ok(
  $$ SELECT * FROM reporting.event_counters('00000000-0000-4000-8000-0000000007e1') $$,
  '42501', NULL, 'another organization cannot read the counters'
);
SELECT throws_ok(
  $$ SELECT * FROM reporting.event_devices('00000000-0000-4000-8000-0000000007e1') $$,
  '42501', NULL, 'another organization cannot read the devices'
);

SELECT identity.set_actor('00000000-0000-4000-8000-0000000007b3', 'admin');
SELECT is(
  (SELECT sold FROM reporting.event_counters('00000000-0000-4000-8000-0000000007e1')),
  2, 'an administrator reads any event'
);

SELECT identity.set_actor(NULL, 'system');
SELECT throws_ok(
  $$ SELECT * FROM reporting.event_counters('00000000-0000-4000-8000-0000000007e1') $$,
  '42501', NULL, 'the system actor does not read dashboards'
);

SELECT * FROM finish();
ROLLBACK;
