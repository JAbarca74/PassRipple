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

-- Un evento insertado sin ends_at recibe starts_at + 12 h
INSERT INTO events.events (id, org_id, canton_code, name, venue_name, starts_at, age_rating, permitted_capacity) VALUES
  ('00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-00000000000a', 'TEST-01', 'Ev1', 'Venue', '2024-01-01 10:00:00+00', 'all', 10);

SELECT is(
  (SELECT ends_at FROM events.events WHERE id = '00000000-0000-4000-8000-000000000010'),
  '2024-01-01 22:00:00+00'::timestamptz,
  'ends_at defaults to starts_at + 12 hours'
);

-- Con ends_at explícito lo conserva
INSERT INTO events.events (id, org_id, canton_code, name, venue_name, starts_at, ends_at, age_rating, permitted_capacity) VALUES
  ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-00000000000a', 'TEST-01', 'Ev2', 'Venue', '2024-01-02 10:00:00+00', '2024-01-02 15:00:00+00', 'all', 10);

SELECT is(
  (SELECT ends_at FROM events.events WHERE id = '00000000-0000-4000-8000-000000000011'),
  '2024-01-02 15:00:00+00'::timestamptz,
  'explicit ends_at is preserved'
);

-- ends_at <= starts_at viola events_window
SELECT throws_ok(
  $$ INSERT INTO events.events (org_id, canton_code, name, venue_name, starts_at, ends_at, age_rating, permitted_capacity)
     VALUES ('00000000-0000-4000-8000-00000000000a', 'TEST-01', 'Ev3', 'Venue', '2024-01-03 10:00:00+00', '2024-01-03 09:00:00+00', 'all', 10) $$,
  '23514', NULL, 'ends_at before starts_at violates events_window'
);
SELECT throws_ok(
  $$ INSERT INTO events.events (org_id, canton_code, name, venue_name, starts_at, ends_at, age_rating, permitted_capacity)
     VALUES ('00000000-0000-4000-8000-00000000000a', 'TEST-01', 'Ev3', 'Venue', '2024-01-03 10:00:00+00', '2024-01-03 10:00:00+00', 'all', 10) $$,
  '23514', NULL, 'ends_at equal to starts_at violates events_window'
);

-- ── API actions ──────────────────────────────────────────────────────────────
SET LOCAL SESSION AUTHORIZATION passripple_api;
SELECT identity.set_actor('00000000-0000-4000-8000-00000000000c', 'organizer', '00000000-0000-4000-8000-00000000000a');

-- mover starts_at después de ends_at falla
SELECT throws_ok(
  $$ UPDATE events.events SET starts_at = '2024-01-03 00:00:00+00' WHERE id = '00000000-0000-4000-8000-000000000011' $$,
  '23514', NULL, 'moving starts_at past ends_at violates events_window'
);

-- El organizador del evento puede mover ends_at
UPDATE events.events SET ends_at = '2024-01-02 20:00:00+00' WHERE id = '00000000-0000-4000-8000-000000000011';
SELECT is(
  (SELECT ends_at FROM events.events WHERE id = '00000000-0000-4000-8000-000000000011'),
  '2024-01-02 20:00:00+00'::timestamptz,
  'the organizer can update ends_at'
);

-- Puede crear un evento con su propio ends_at
SELECT lives_ok(
  $$ INSERT INTO events.events (org_id, canton_code, name, venue_name, starts_at, ends_at, age_rating, permitted_capacity)
     VALUES ('00000000-0000-4000-8000-00000000000a', 'TEST-01', 'Ev4', 'Venue', '2024-01-04 10:00:00+00', '2024-01-04 18:00:00+00', 'all', 10) $$,
  'the organizer can insert an event with ends_at'
);

-- Otra organización no lo ve ni lo cambia (RLS)
SELECT identity.set_actor('00000000-0000-4000-8000-00000000000d', 'organizer', '00000000-0000-4000-8000-00000000000b');
WITH updated AS (
  UPDATE events.events SET ends_at = '2024-01-02 21:00:00+00'
   WHERE id = '00000000-0000-4000-8000-000000000011' RETURNING 1
)
SELECT is((SELECT count(*)::int FROM updated), 0, 'an organizer of another org cannot update ends_at');

-- Un comprador no crea eventos
SELECT identity.set_actor(NULL, 'buyer');
SELECT throws_ok(
  $$ INSERT INTO events.events (org_id, canton_code, name, venue_name, starts_at, age_rating, permitted_capacity)
     VALUES ('00000000-0000-4000-8000-00000000000a', 'TEST-01', 'Ev5', 'Venue', '2024-01-05 10:00:00+00', 'all', 10) $$,
  '42501', NULL, 'a buyer cannot insert events'
);

RESET ROLE;

SELECT * FROM finish(true);
ROLLBACK;
