BEGIN;
SELECT plan(4);

-- ── Superuser setup ──────────────────────────────────────────────────────────
INSERT INTO identity.organizations (id, name, verified_at) VALUES
  ('00000000-0000-4000-8000-00000000000a', 'Org 1', now());
INSERT INTO identity.users (id, is_admin) VALUES
  ('00000000-0000-4000-8000-00000000000b', false);
INSERT INTO jurisdictions.jurisdictions (canton_code, name, tax_rate_bps, courtesy_deduct_bps, settlement_rule) VALUES
  ('TEST-01', 'Test', 0, '{}', 'next_business_day');
INSERT INTO events.events (id, org_id, canton_code, name, venue_name, starts_at, age_rating, permitted_capacity, status, published_at) VALUES
  ('00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-00000000000a', 'TEST-01', 'Event 1', 'Venue', now(), 'all', 10, 'on_sale', now());
INSERT INTO catalog.ticket_types (id, event_id, name, price_crc, audience, entry_mode) VALUES
  ('00000000-0000-4000-8000-000000000020', '00000000-0000-4000-8000-000000000010', 'Public 1', 1000, 'public', 'single_use');
INSERT INTO staff.staff_devices (id, event_id, user_id, role, valid_from, valid_until) VALUES
  ('00000000-0000-4000-8000-000000000030', '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-00000000000b', 'gate', now() - interval '1 day', now() + interval '1 day');
INSERT INTO ticketing.tickets (id, event_id, ticket_type_id, origin, code_human) VALUES
  ('00000000-0000-4000-8000-000000000040', '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000020', 'courtesy', 'C0DE400000');

SELECT col_not_null('redemption', 'redemptions', 'change_xid', 'every redemption carries change_xid');

-- ── API actions ──────────────────────────────────────────────────────────────
SET LOCAL SESSION AUTHORIZATION passripple_api;
SELECT identity.set_actor('00000000-0000-4000-8000-00000000000b', 'staff');

SELECT is(
  (SELECT redemption.record_scan('00000000-0000-4000-8000-000000000050', '00000000-0000-4000-8000-000000000040',
     '00000000-0000-4000-8000-000000000030', 1, now(), 0, 'qr', false)),
  'admitted',
  'the scan is recorded'
);

RESET ROLE;

-- Un canje nuevo lleva la transacción que lo registró, así el manifiesto lo manda a los
-- dispositivos cuyo cursor es anterior.
SELECT is(
  (SELECT change_xid FROM redemption.redemptions WHERE id = '00000000-0000-4000-8000-000000000050'),
  pg_current_xact_id(),
  'a new redemption carries the transaction that recorded it'
);

-- Los canjes son de solo inserción: la API no puede reescribir la marca.
SET LOCAL SESSION AUTHORIZATION passripple_api;
SELECT throws_ok(
  $$ UPDATE redemption.redemptions SET change_xid = '1'::xid8 WHERE id = '00000000-0000-4000-8000-000000000050' $$,
  '42501', NULL, 'the API cannot rewrite a redemption''s change_xid'
);
RESET ROLE;

SELECT * FROM finish(true);
ROLLBACK;
