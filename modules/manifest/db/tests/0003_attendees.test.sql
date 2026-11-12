BEGIN;
SELECT plan(4);

-- ── Superuser setup: an 18+ event, two tickets, one with its attendee ───────
INSERT INTO identity.organizations (id, name, verified_at) VALUES
  ('00000000-0000-4000-8000-00000000000a', 'Org 1', now());
INSERT INTO identity.users (id, is_admin) VALUES ('00000000-0000-4000-8000-00000000000b', false);
INSERT INTO jurisdictions.jurisdictions (canton_code, name, tax_rate_bps, courtesy_deduct_bps, settlement_rule) VALUES
  ('TEST-01', 'Test', 0, '{}', 'next_business_day');
INSERT INTO events.events (id, org_id, canton_code, name, venue_name, starts_at, age_rating, permitted_capacity, status, published_at) VALUES
  ('00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-00000000000a', 'TEST-01', 'Adults', 'Venue', now() + interval '1 day', '18plus', 10, 'on_sale', now());
INSERT INTO catalog.ticket_types (id, event_id, name, price_crc, audience, entry_mode) VALUES
  ('00000000-0000-4000-8000-000000000020', '00000000-0000-4000-8000-000000000010', 'General', 1000, 'public', 'single_use');
INSERT INTO ticketing.tickets (id, event_id, ticket_type_id, origin, code_human) VALUES
  ('00000000-0000-4000-8000-000000000040', '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000020', 'courtesy', 'A77E400000'),
  ('00000000-0000-4000-8000-000000000041', '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000020', 'courtesy', 'A77E410000');
INSERT INTO ticketing.attendees (ticket_id, full_name, doc_type, doc_last4, doc_number_enc, assigned_by) VALUES
  ('00000000-0000-4000-8000-000000000040', 'Ana Mora', 'cedula', '6789', decode(repeat('ab', 40), 'hex'), 'buyer');
INSERT INTO staff.staff_devices (id, event_id, user_id, role, valid_from, valid_until) VALUES
  ('00000000-0000-4000-8000-000000000030', '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-00000000000b', 'gate', now() - interval '1 day', now() + interval '2 days');

SET LOCAL SESSION AUTHORIZATION passripple_api;
SELECT identity.set_actor('00000000-0000-4000-8000-00000000000b', 'staff');

SELECT is((SELECT named_tickets FROM manifest.gate_event('00000000-0000-4000-8000-000000000030')),
          true, 'the manifest says the event is named');
SELECT results_eq(
  $$SELECT ticket_id::text, attendee_name, attendee_doc_last4
      FROM manifest.gate_tickets('00000000-0000-4000-8000-000000000030') ORDER BY 1$$,
  $$VALUES ('00000000-0000-4000-8000-000000000040', 'Ana Mora', '6789'),
           ('00000000-0000-4000-8000-000000000041', NULL::text, NULL::text)$$,
  'each ticket carries its attendee''s name and last digits, or nothing');
SELECT is(
  (SELECT 'doc_number_enc' = ANY (proargnames) FROM pg_proc
    WHERE oid = 'manifest.gate_tickets(uuid, xid8)'::regprocedure),
  false, 'gate_tickets has no way to return the document number');
SELECT throws_ok($$SELECT * FROM ticketing.attendees$$, '42501', NULL,
  'the API still cannot read the attendees table');

SELECT * FROM finish();
ROLLBACK;
