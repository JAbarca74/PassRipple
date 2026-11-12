-- Phase 9: a device of one zone that admits a ticket of another zone is recorded and flagged.
BEGIN;
SELECT plan(6);

INSERT INTO identity.organizations (id, name, verified_at) VALUES
  ('00000000-0000-4000-8000-0000000009a1', 'Zone Org', now());
INSERT INTO identity.users (id, is_admin) VALUES
  ('00000000-0000-4000-8000-0000000009b1', false),
  ('00000000-0000-4000-8000-0000000009b2', false);
INSERT INTO jurisdictions.jurisdictions (canton_code, name, tax_rate_bps, courtesy_deduct_bps, settlement_rule) VALUES
  ('ZONE-01', 'Zone Canton', 0, '{}', 'next_business_day');
INSERT INTO events.events (id, org_id, canton_code, name, venue_name, starts_at, age_rating, permitted_capacity, status, published_at) VALUES
  ('00000000-0000-4000-8000-0000000009e1', '00000000-0000-4000-8000-0000000009a1', 'ZONE-01', 'Zone Event', 'Ring', now(), 'all', 10, 'on_sale', now());
INSERT INTO catalog.ticket_types (id, event_id, name, zone, price_crc) VALUES
  ('00000000-0000-4000-8000-0000000009c1', '00000000-0000-4000-8000-0000000009e1', 'Sun', 'sun', 1000),
  ('00000000-0000-4000-8000-0000000009c2', '00000000-0000-4000-8000-0000000009e1', 'Shade', 'shade', 2000),
  ('00000000-0000-4000-8000-0000000009c3', '00000000-0000-4000-8000-0000000009e1', 'General', NULL, 500);
INSERT INTO ticketing.tickets (id, event_id, ticket_type_id, origin, code_human, status) VALUES
  ('00000000-0000-4000-8000-0000000009d1', '00000000-0000-4000-8000-0000000009e1', '00000000-0000-4000-8000-0000000009c1', 'courtesy', 'Z0NE000001', 'issued'),
  ('00000000-0000-4000-8000-0000000009d2', '00000000-0000-4000-8000-0000000009e1', '00000000-0000-4000-8000-0000000009c2', 'courtesy', 'Z0NE000002', 'issued'),
  ('00000000-0000-4000-8000-0000000009d3', '00000000-0000-4000-8000-0000000009e1', '00000000-0000-4000-8000-0000000009c3', 'courtesy', 'Z0NE000003', 'issued');
INSERT INTO staff.staff_devices (id, event_id, user_id, role, zone, valid_from, valid_until) VALUES
  ('00000000-0000-4000-8000-0000000009f1', '00000000-0000-4000-8000-0000000009e1', '00000000-0000-4000-8000-0000000009b1', 'gate', 'sun', now() - interval '1 day', now() + interval '1 day'),
  ('00000000-0000-4000-8000-0000000009f2', '00000000-0000-4000-8000-0000000009e1', '00000000-0000-4000-8000-0000000009b2', 'gate', NULL, now() - interval '1 day', now() + interval '1 day');

CREATE FUNCTION pg_temp.op(p_id text, p_seq integer, p_ticket text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('id', p_id, 'deviceSeq', p_seq, 'opType', 'redemption',
    'createdAt', floor(extract(epoch FROM now()) * 1000), 'clockOffsetMs', 0,
    'payload', jsonb_build_object('ticketId', p_ticket, 'method', 'qr', 'idChecked', false, 'inManifest', true))
$$;
GRANT EXECUTE ON FUNCTION pg_temp.op(text, integer, text) TO passripple_api;

SET LOCAL SESSION AUTHORIZATION passripple_api;
SELECT identity.set_actor('00000000-0000-4000-8000-0000000009b1', 'staff');

SELECT is(
  redemption.apply_batch('00000000-0000-4000-8000-0000000009f1', jsonb_build_array(
    pg_temp.op('00000000-0000-4000-8000-000000000a01', 1, '00000000-0000-4000-8000-0000000009d1'))) -> 0 ->> 'outcome',
  'admitted', 'a ticket of the device''s own zone is admitted');
SELECT is(
  redemption.apply_batch('00000000-0000-4000-8000-0000000009f1', jsonb_build_array(
    pg_temp.op('00000000-0000-4000-8000-000000000a02', 2, '00000000-0000-4000-8000-0000000009d3'))) -> 0 ->> 'outcome',
  'admitted', 'a ticket of a type without a zone is admitted anywhere');
SELECT is(
  redemption.apply_batch('00000000-0000-4000-8000-0000000009f1', jsonb_build_array(
    pg_temp.op('00000000-0000-4000-8000-000000000a03', 3, '00000000-0000-4000-8000-0000000009d2'))) -> 0 ->> 'outcome',
  'admitted', 'a ticket of another zone is still recorded: nothing a device recorded is dropped');
SELECT is(
  (SELECT array_agg(i.kind) FROM redemption.incidents i WHERE i.device_id = '00000000-0000-4000-8000-0000000009f1'),
  ARRAY['wrong_zone'], 'only the ticket of the other zone raised an incident');
SELECT is(
  (SELECT i.ticket_id FROM redemption.incidents i WHERE i.kind = 'wrong_zone'),
  '00000000-0000-4000-8000-0000000009d2'::uuid, 'the incident names the ticket');

SELECT identity.set_actor('00000000-0000-4000-8000-0000000009b2', 'staff');
SELECT is(
  redemption.apply_batch('00000000-0000-4000-8000-0000000009f2', jsonb_build_array(
    pg_temp.op('00000000-0000-4000-8000-000000000a04', 1, '00000000-0000-4000-8000-0000000009d1'))) -> 0 ->> 'outcome',
  'duplicate', 'a device without a zone scans any ticket (here a repeat of an admitted one)');

SELECT * FROM finish(true);
ROLLBACK;
