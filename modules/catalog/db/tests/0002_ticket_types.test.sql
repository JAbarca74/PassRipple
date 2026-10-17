BEGIN;
SELECT plan(9);

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
  ('00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-00000000000a', 'TEST-01', 'Event 1 (Draft)', 'Venue', now(), 'all', 100, 'draft', NULL),
  ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-00000000000a', 'TEST-01', 'Event 2 (On Sale)', 'Venue', now(), 'all', 100, 'on_sale', now());

INSERT INTO catalog.ticket_types (id, event_id, name, price_crc, audience) VALUES
  ('00000000-0000-4000-8000-000000000020', '00000000-0000-4000-8000-000000000010', 'General Draft', 1000, 'public'),
  ('00000000-0000-4000-8000-000000000021', '00000000-0000-4000-8000-000000000011', 'General On Sale', 1000, 'public'),
  ('00000000-0000-4000-8000-000000000022', '00000000-0000-4000-8000-000000000011', 'Staff Only', 0, 'staff');

-- ── API actions ──────────────────────────────────────────────────────────────
SET LOCAL SESSION AUTHORIZATION passripple_api;

SELECT identity.set_actor('00000000-0000-4000-8000-00000000000d', 'organizer', '00000000-0000-4000-8000-00000000000b');

SELECT is((SELECT count(*)::int FROM catalog.ticket_types WHERE id = '00000000-0000-4000-8000-000000000020'), 0, 'organizer cannot see draft ticket type of another org');

SELECT throws_ok(
  $$ INSERT INTO catalog.ticket_types (event_id, name, price_crc, audience) VALUES ('00000000-0000-4000-8000-000000000010', 'Hacked', 100, 'public') $$,
  '42501', NULL, 'organizer cannot insert ticket type for another org event'
);

WITH updated AS (UPDATE catalog.ticket_types SET price_crc = 0 WHERE id = '00000000-0000-4000-8000-000000000020' RETURNING 1)
SELECT is((SELECT count(*)::int FROM updated), 0, 'organizer cannot update ticket type of another org');

SELECT identity.set_actor('00000000-0000-4000-8000-00000000000c', 'organizer', '00000000-0000-4000-8000-00000000000a');

-- Row Level Security filters the row out instead of raising: nothing is deleted.
WITH deleted AS (DELETE FROM catalog.ticket_types WHERE id = '00000000-0000-4000-8000-000000000021' RETURNING 1)
SELECT is((SELECT count(*)::int FROM deleted), 0, 'cannot delete a ticket type after event goes on sale');

SELECT throws_ok(
  $$ INSERT INTO catalog.ticket_types (event_id, name, price_crc, audience, entry_mode) VALUES ('00000000-0000-4000-8000-000000000010', 'Multi', 1000, 'public', 'multi_scan') $$,
  '23514', NULL, 'public ticket type cannot be multi_scan'
);

SELECT lives_ok(
  $$ INSERT INTO catalog.ticket_types (event_id, name, price_crc, audience, entry_mode) VALUES ('00000000-0000-4000-8000-000000000010', 'Multi Staff', 0, 'staff', 'multi_scan') $$,
  'staff ticket type can be multi_scan'
);

SELECT identity.set_actor(NULL, 'buyer');
SELECT is((SELECT count(*)::int FROM catalog.ticket_types WHERE id = '00000000-0000-4000-8000-000000000020'), 0, 'buyer cannot see ticket types of drafts');
SELECT is((SELECT count(*)::int FROM catalog.ticket_types WHERE id = '00000000-0000-4000-8000-000000000022'), 0, 'buyer cannot see staff ticket types');
SELECT is((SELECT count(*)::int FROM catalog.ticket_types WHERE id = '00000000-0000-4000-8000-000000000021'), 1, 'buyer sees public ticket type of on sale event');

RESET SESSION AUTHORIZATION;
SELECT * FROM finish(true);
ROLLBACK;
