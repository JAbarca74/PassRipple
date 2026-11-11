BEGIN;
SELECT plan(19);

-- ── Superuser setup ──────────────────────────────────────────────────────────
INSERT INTO identity.organizations (id, name, verified_at) VALUES
  ('00000000-0000-4000-8000-00000000000a', 'Org 1', now());
INSERT INTO jurisdictions.jurisdictions (canton_code, name, tax_rate_bps, courtesy_deduct_bps, settlement_rule) VALUES
  ('TEST-01', 'Test', 0, '{}', 'next_business_day');

INSERT INTO events.events (id, org_id, canton_code, name, venue_name, starts_at, ends_at, age_rating, permitted_capacity, status, published_at) VALUES
  ('00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-00000000000a', 'TEST-01', 'Adults', 'Arena', now() + interval '1 day', now() + interval '2 days', '18plus', 10, 'on_sale', now()),
  ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-00000000000a', 'TEST-01', 'All ages', 'Arena', now() + interval '1 day', now() + interval '2 days', 'all', 10, 'on_sale', now()),
  ('00000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-00000000000a', 'TEST-01', 'Started', 'Arena', now() - interval '1 hour', now() + interval '2 hours', '12plus', 10, 'on_sale', now()),
  ('00000000-0000-4000-8000-000000000013', '00000000-0000-4000-8000-00000000000a', 'TEST-01', 'Long gone', 'Arena', now() - interval '60 days', now() - interval '59 days', '18plus', 10, 'on_sale', now());

-- ── 1. Which events are named ────────────────────────────────────────────────
SELECT is((SELECT named_tickets FROM events.events WHERE id = '00000000-0000-4000-8000-000000000010'),
          true, 'an 18+ event is named');
SELECT is((SELECT named_tickets FROM events.events WHERE id = '00000000-0000-4000-8000-000000000011'),
          false, 'an all-ages event is not named by default');
SELECT is((SELECT named_tickets FROM events.events WHERE id = '00000000-0000-4000-8000-000000000012'),
          true, 'a 12+ event is named by default');
SELECT throws_ok(
  $$UPDATE events.events SET named_tickets = false WHERE id = '00000000-0000-4000-8000-000000000010'$$,
  '23514', NULL, 'an 18+ event cannot drop named tickets');
UPDATE events.events SET named_tickets = false WHERE id = '00000000-0000-4000-8000-000000000012';
SELECT is((SELECT named_tickets FROM events.events WHERE id = '00000000-0000-4000-8000-000000000012'),
          false, 'a 12+ event may drop named tickets (owner decision, default on)');
UPDATE events.events SET named_tickets = true WHERE id = '00000000-0000-4000-8000-000000000012';

INSERT INTO catalog.ticket_types (id, event_id, name, price_crc, audience, entry_mode) VALUES
  ('00000000-0000-4000-8000-000000000020', '00000000-0000-4000-8000-000000000010', 'G', 1000, 'public', 'single_use'),
  ('00000000-0000-4000-8000-000000000021', '00000000-0000-4000-8000-000000000011', 'G', 1000, 'public', 'single_use'),
  ('00000000-0000-4000-8000-000000000022', '00000000-0000-4000-8000-000000000012', 'G', 1000, 'public', 'single_use'),
  ('00000000-0000-4000-8000-000000000023', '00000000-0000-4000-8000-000000000013', 'G', 1000, 'public', 'single_use');

INSERT INTO ticketing.tickets (id, event_id, ticket_type_id, origin, code_human) VALUES
  ('00000000-0000-4000-8000-000000000040', '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000020', 'courtesy', 'A77E400000'),
  ('00000000-0000-4000-8000-000000000041', '00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000021', 'courtesy', 'A77E410000'),
  ('00000000-0000-4000-8000-000000000042', '00000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-000000000022', 'courtesy', 'A77E420000'),
  ('00000000-0000-4000-8000-000000000043', '00000000-0000-4000-8000-000000000013', '00000000-0000-4000-8000-000000000023', 'courtesy', 'A77E430000');

SELECT set_config('app.actor_role', 'system', true);
SELECT ticketing.bind(id, decode(repeat('11', 32), 'hex'), 'bind')
  FROM ticketing.tickets WHERE code_human LIKE 'A77E%';

-- ── 2. Assigning ─────────────────────────────────────────────────────────────
SELECT lives_ok(
  $$SELECT ticketing.assign_attendee('00000000-0000-4000-8000-000000000040', decode(repeat('11', 32), 'hex'),
      ' Ana Mora ', 'cedula', '4567', decode(repeat('ab', 40), 'hex'), 'buyer')$$,
  'the holder assigns the attendee of a named ticket');
SELECT results_eq(
  $$SELECT full_name, doc_type, doc_last4 FROM ticketing.attendee_view(ARRAY['00000000-0000-4000-8000-000000000040'::uuid])$$,
  $$VALUES ('Ana Mora', 'cedula', '4567')$$,
  'the wallet view shows the name trimmed and the last digits');
SELECT lives_ok(
  $$SELECT ticketing.assign_attendee('00000000-0000-4000-8000-000000000040', decode(repeat('11', 32), 'hex'),
      'Luis Rojas', 'dimex', 'x9z1', decode(repeat('cd', 40), 'hex'), 'buyer')$$,
  'the holder may change the attendee before the event');
SELECT is((SELECT full_name || '/' || doc_last4 FROM ticketing.attendees
            WHERE ticket_id = '00000000-0000-4000-8000-000000000040'),
          'Luis Rojas/X9Z1', 'the new attendee replaces the old one, last digits in capitals');
SELECT throws_ok(
  $$SELECT ticketing.assign_attendee('00000000-0000-4000-8000-000000000040', decode(repeat('22', 32), 'hex'),
      'Eva', 'cedula', '1234', decode(repeat('ab', 40), 'hex'), 'buyer')$$,
  '42501', NULL, 'another key cannot assign');
SELECT throws_ok(
  $$SELECT ticketing.assign_attendee('00000000-0000-4000-8000-000000000041', decode(repeat('11', 32), 'hex'),
      'Eva Solis', 'cedula', '1234', decode(repeat('ab', 40), 'hex'), 'buyer')$$,
  '22023', NULL, 'an event without named tickets refuses attendees');
SELECT throws_ok(
  $$SELECT ticketing.assign_attendee('00000000-0000-4000-8000-000000000042', decode(repeat('11', 32), 'hex'),
      'Eva Solis', 'cedula', '1234', decode(repeat('ab', 40), 'hex'), 'buyer')$$,
  '55000', NULL, 'after the event starts only the gate captures attendees');
SELECT throws_ok(
  $$SELECT ticketing.assign_attendee('00000000-0000-4000-8000-000000000040', decode(repeat('11', 32), 'hex'),
      'Eva Solis', 'cedula', '1234', decode(repeat('ab', 40), 'hex'), 'door')$$,
  '22023', NULL, 'the wallet cannot pose as the door');
SELECT throws_ok(
  $$SELECT ticketing.assign_attendee('00000000-0000-4000-8000-000000000040', decode(repeat('11', 32), 'hex'),
      'Eva Solis', 'cedula', '1234', NULL, 'buyer')$$,
  '23502', NULL, 'the document number is required');

-- ── 3. Who may call ──────────────────────────────────────────────────────────
SELECT set_config('app.actor_role', 'buyer', true);
SELECT throws_ok(
  $$SELECT ticketing.assign_attendee('00000000-0000-4000-8000-000000000040', decode(repeat('11', 32), 'hex'),
      'Eva Solis', 'cedula', '1234', decode(repeat('ab', 40), 'hex'), 'buyer')$$,
  '42501', NULL, 'only the system assigns');
SELECT is((SELECT count(*)::int FROM ticketing.attendee_view(ARRAY['00000000-0000-4000-8000-000000000040'::uuid])),
          0, 'only the system reads the wallet view');
SET LOCAL ROLE passripple_api;
SELECT throws_ok($$SELECT * FROM ticketing.attendees$$, '42501', NULL,
                 'the API cannot read the attendees table');
RESET ROLE;

-- ── 4. Retention ─────────────────────────────────────────────────────────────
-- An attendee of an event that ended 59 days ago, inserted directly as the old data.
INSERT INTO ticketing.attendees (ticket_id, full_name, doc_type, doc_last4, doc_number_enc, assigned_by)
VALUES ('00000000-0000-4000-8000-000000000043', 'Old Guest', 'cedula', '9999', decode(repeat('ef', 40), 'hex'), 'buyer');
SELECT set_config('app.actor_role', 'system', true);
SELECT is(ticketing.purge_attendee_documents(30), 1, 'only documents past retention are erased');
SELECT is((SELECT doc_number_enc IS NULL AND purged_at IS NOT NULL AND full_name = 'Old Guest'
             FROM ticketing.attendees WHERE ticket_id = '00000000-0000-4000-8000-000000000043'),
          true, 'the number is gone, the name and last digits stay for the event record');

SELECT * FROM finish();
ROLLBACK;
