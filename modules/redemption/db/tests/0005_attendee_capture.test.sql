BEGIN;
SELECT plan(7);

-- ── Superuser setup ──────────────────────────────────────────────────────────
INSERT INTO identity.organizations (id, name, verified_at) VALUES
  ('00000000-0000-4000-8000-00000000000a', 'Org 1', now());
INSERT INTO identity.users (id, is_admin) VALUES
  ('00000000-0000-4000-8000-00000000000b', false);
INSERT INTO jurisdictions.jurisdictions (canton_code, name, tax_rate_bps, courtesy_deduct_bps, settlement_rule) VALUES
  ('TEST-01', 'Test', 0, '{}', 'next_business_day');
INSERT INTO events.events (id, org_id, canton_code, name, venue_name, starts_at, age_rating, permitted_capacity, status, published_at) VALUES
  ('00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-00000000000a', 'TEST-01', 'Adults', 'Venue', now(), '18plus', 10, 'on_sale', now());
INSERT INTO catalog.ticket_types (id, event_id, name, price_crc, audience, entry_mode) VALUES
  ('00000000-0000-4000-8000-000000000020', '00000000-0000-4000-8000-000000000010', 'Public', 1000, 'public', 'single_use');
INSERT INTO ticketing.tickets (id, event_id, ticket_type_id, origin, code_human, status) VALUES
  ('00000000-0000-4000-8000-000000000040', '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000020', 'courtesy', 'C0DE400000', 'issued');
INSERT INTO staff.staff_devices (id, event_id, user_id, role, valid_from, valid_until) VALUES
  ('00000000-0000-4000-8000-000000000030', '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-00000000000b', 'gate', now() - interval '1 day', now() + interval '1 day');

CREATE FUNCTION pg_temp.capture(p_id text, p_seq integer, p_payload jsonb) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('id', p_id, 'deviceSeq', p_seq, 'opType', 'attendee_capture',
                            'createdAt', floor(extract(epoch FROM now()) * 1000), 'clockOffsetMs', 0,
                            'payload', p_payload)
$$;
GRANT EXECUTE ON FUNCTION pg_temp.capture(text, integer, jsonb) TO passripple_api;

SET LOCAL SESSION AUTHORIZATION passripple_api;
SELECT identity.set_actor('00000000-0000-4000-8000-00000000000b', 'staff');

SELECT is(
  redemption.apply_batch('00000000-0000-4000-8000-000000000030', jsonb_build_array(
    pg_temp.capture('01900000-0000-7000-8000-000000000001', 1,
      '{"ticketId": "00000000-0000-4000-8000-000000000040", "fullName": " Ana Mora ", "docType": "cedula", "docLast4": "6789"}'))),
  '[{"id": "01900000-0000-7000-8000-000000000001", "status": "applied"}]'::jsonb,
  'the gate records an attendee captured at the door');
SELECT is(
  redemption.apply_batch('00000000-0000-4000-8000-000000000030', jsonb_build_array(
    pg_temp.capture('01900000-0000-7000-8000-000000000001', 1,
      '{"ticketId": "00000000-0000-4000-8000-000000000040", "fullName": "Ana Mora", "docType": "cedula", "docLast4": "6789"}'))),
  '[{"id": "01900000-0000-7000-8000-000000000001", "status": "duplicate"}]'::jsonb,
  'the same operation synced twice is a duplicate');
SELECT is(
  redemption.apply_batch('00000000-0000-4000-8000-000000000030', jsonb_build_array(
    pg_temp.capture('01900000-0000-7000-8000-000000000002', 2,
      '{"ticketId": "00000000-0000-4000-8000-000000000040", "fullName": "Luis Rojas", "docType": "pasaporte", "docLast4": "ab12"}'))),
  '[{"id": "01900000-0000-7000-8000-000000000002", "status": "applied"}]'::jsonb,
  'a second capture of the same ticket is kept too: nothing at the door is refused');
SELECT is(
  (redemption.apply_batch('00000000-0000-4000-8000-000000000030', jsonb_build_array(
    pg_temp.capture('01900000-0000-7000-8000-000000000003', 3,
      '{"ticketId": "00000000-0000-4000-8000-000000000040", "fullName": "Eva", "docType": "cedula", "docLast4": "123456789"}')))->0->>'status'),
  'rejected', 'a full document number is refused: only the last digits travel');

SELECT is((SELECT count(*)::int FROM redemption.attendee_captures), 0,
          'a staff member does not read captured names back');
RESET SESSION AUTHORIZATION;
SELECT results_eq(
  $$SELECT full_name, doc_type, doc_last4 FROM redemption.attendee_captures ORDER BY device_seq$$,
  $$VALUES ('Ana Mora', 'cedula', '6789'), ('Luis Rojas', 'pasaporte', 'AB12')$$,
  'names are trimmed and last digits in capitals');
SELECT throws_ok(
  $$UPDATE redemption.attendee_captures SET full_name = 'X'$$,
  NULL, NULL, 'captures are append-only');

SELECT * FROM finish();
ROLLBACK;
