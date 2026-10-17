BEGIN;
SELECT plan(26);

-- ── Superuser setup ──────────────────────────────────────────────────────────
-- Users: 0b and 0c staff members.
INSERT INTO identity.organizations (id, name, verified_at) VALUES
  ('00000000-0000-4000-8000-00000000000a', 'Org 1', now());
INSERT INTO identity.users (id, is_admin) VALUES
  ('00000000-0000-4000-8000-00000000000b', false),
  ('00000000-0000-4000-8000-00000000000c', false);
INSERT INTO jurisdictions.jurisdictions (canton_code, name, tax_rate_bps, courtesy_deduct_bps, settlement_rule) VALUES
  ('TEST-01', 'Test', 0, '{}', 'next_business_day');
INSERT INTO events.events (id, org_id, canton_code, name, venue_name, starts_at, age_rating, permitted_capacity, status, published_at) VALUES
  ('00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-00000000000a', 'TEST-01', 'Event 1', 'Venue', now(), 'all', 10, 'on_sale', now());
INSERT INTO catalog.ticket_types (id, event_id, name, price_crc, audience, entry_mode) VALUES
  ('00000000-0000-4000-8000-000000000020', '00000000-0000-4000-8000-000000000010', 'Public', 1000, 'public', 'single_use'),
  ('00000000-0000-4000-8000-000000000021', '00000000-0000-4000-8000-000000000010', 'Staff', 0, 'staff', 'multi_scan');
INSERT INTO ticketing.tickets (id, event_id, ticket_type_id, origin, code_human, status) VALUES
  ('00000000-0000-4000-8000-000000000040', '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000020', 'courtesy', 'C0DE400000', 'issued'),
  ('00000000-0000-4000-8000-000000000041', '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000020', 'courtesy', 'C0DE410000', 'issued'),
  ('00000000-0000-4000-8000-000000000042', '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000020', 'courtesy', 'C0DE420000', 'issued'),
  ('00000000-0000-4000-8000-000000000043', '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000021', 'courtesy', 'C0DE430000', 'issued');

-- Devices: 30 of 0b, 31 of 0c, 32 of 0b revoked an hour ago.
INSERT INTO staff.staff_devices (id, event_id, user_id, role, valid_from, valid_until, revoked_at) VALUES
  ('00000000-0000-4000-8000-000000000030', '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-00000000000b', 'gate', now() - interval '1 day', now() + interval '1 day', NULL),
  ('00000000-0000-4000-8000-000000000031', '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-00000000000c', 'gate', now() - interval '1 day', now() + interval '1 day', NULL),
  ('00000000-0000-4000-8000-000000000032', '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-00000000000b', 'gate', now() - interval '1 day', now() + interval '1 day', now() - interval '1 hour');

-- One queued operation, as the device sends it (createdAt in device milliseconds).
CREATE FUNCTION pg_temp.op(p_id text, p_seq integer, p_type text, p_payload jsonb,
                           p_at timestamptz DEFAULT now())
RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('id', p_id, 'deviceSeq', p_seq, 'opType', p_type,
                            'createdAt', floor(extract(epoch FROM p_at) * 1000), 'clockOffsetMs', 0,
                            'payload', p_payload)
$$;
CREATE FUNCTION pg_temp.scan(p_ticket text, p_in_manifest boolean DEFAULT true) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('ticketId', p_ticket, 'method', 'qr', 'idChecked', false, 'inManifest', p_in_manifest)
$$;
GRANT EXECUTE ON FUNCTION pg_temp.op(text, integer, text, jsonb, timestamptz), pg_temp.scan(text, boolean) TO passripple_api;

-- ── Who uploads ──────────────────────────────────────────────────────────────
SET LOCAL SESSION AUTHORIZATION passripple_api;

SELECT identity.set_actor(NULL, 'system');
SELECT throws_ok(
  $$ SELECT redemption.apply_batch('00000000-0000-4000-8000-000000000030',
       jsonb_build_array(pg_temp.op('00000000-0000-4000-8000-000000000070', 1, 'redemption', pg_temp.scan('00000000-0000-4000-8000-000000000040')))) $$,
  '42501', NULL, 'the system uploads no batch'
);

SELECT identity.set_actor('00000000-0000-4000-8000-00000000000c', 'staff');
SELECT throws_ok(
  $$ SELECT redemption.apply_batch('00000000-0000-4000-8000-000000000030',
       jsonb_build_array(pg_temp.op('00000000-0000-4000-8000-000000000070', 1, 'redemption', pg_temp.scan('00000000-0000-4000-8000-000000000040')))) $$,
  '42501', NULL, 'a staff member cannot upload for another person''s device'
);

SELECT identity.set_actor('00000000-0000-4000-8000-00000000000b', 'staff');
SELECT throws_ok($$ SELECT redemption.apply_batch('00000000-0000-4000-8000-000000000030', '[]') $$,
  '22023', NULL, 'an empty batch is rejected');
SELECT throws_ok(
  $$ SELECT redemption.apply_batch('00000000-0000-4000-8000-000000000030',
       (SELECT jsonb_agg(pg_temp.op(gen_random_uuid()::text, n, 'redemption', pg_temp.scan('00000000-0000-4000-8000-000000000040')))
          FROM generate_series(1, 101) AS n)) $$,
  '22023', NULL, 'a batch over 100 operations is rejected'
);
SELECT throws_ok($$ SELECT redemption.apply_batch('00000000-0000-4000-8000-000000000030', '{}') $$,
  '22023', NULL, 'a batch that is not an array is rejected');

-- ── Applying and repeating ───────────────────────────────────────────────────
SELECT is(
  redemption.apply_batch('00000000-0000-4000-8000-000000000030', jsonb_build_array(
    pg_temp.op('00000000-0000-4000-8000-000000000070', 1, 'redemption', pg_temp.scan('00000000-0000-4000-8000-000000000040')))),
  '[{"id": "00000000-0000-4000-8000-000000000070", "status": "applied", "outcome": "admitted"}]'::jsonb,
  'a new scan is applied and admitted'
);
SELECT is(
  redemption.apply_batch('00000000-0000-4000-8000-000000000030', jsonb_build_array(
    pg_temp.op('00000000-0000-4000-8000-000000000070', 1, 'redemption', pg_temp.scan('00000000-0000-4000-8000-000000000040')))),
  '[{"id": "00000000-0000-4000-8000-000000000070", "status": "duplicate", "outcome": "admitted"}]'::jsonb,
  'the same scan synced again is a duplicate with its first outcome'
);
SELECT is(
  redemption.apply_batch('00000000-0000-4000-8000-000000000030', jsonb_build_array(
    pg_temp.op('00000000-0000-4000-8000-000000000071', 2, 'redemption', pg_temp.scan('00000000-0000-4000-8000-000000000040')))) -> 0 ->> 'outcome',
  'duplicate',
  'a second scan of an admitted single-use ticket is recorded as duplicate'
);
SELECT is(
  (SELECT count(*)::int FROM redemption.redemptions
    WHERE ticket_id = '00000000-0000-4000-8000-000000000040' AND outcome = 'admitted'),
  1,
  'a single-use ticket is admitted once (I1)'
);

SELECT is(
  redemption.apply_batch('00000000-0000-4000-8000-000000000030', jsonb_build_array(
    pg_temp.op('00000000-0000-4000-8000-000000000072', 3, 'incident', '{"kind": "operator", "note": "door jammed"}'))) -> 0 ->> 'status',
  'applied',
  'a device incident is applied'
);
SELECT is(
  redemption.apply_batch('00000000-0000-4000-8000-000000000030', jsonb_build_array(
    pg_temp.op('00000000-0000-4000-8000-000000000072', 3, 'incident', '{"kind": "operator", "note": "door jammed"}'))) -> 0 ->> 'status',
  'duplicate',
  'the same incident synced again is a duplicate'
);

-- ── One bad operation never fails the batch ──────────────────────────────────
SELECT set_config('test.mixed', redemption.apply_batch('00000000-0000-4000-8000-000000000030', jsonb_build_array(
  pg_temp.op('not-a-uuid', 4, 'redemption', pg_temp.scan('00000000-0000-4000-8000-000000000041')),
  pg_temp.op('00000000-0000-4000-8000-000000000073', 5, 'teleport', '{}'),
  pg_temp.op('00000000-0000-4000-8000-000000000074', 6, 'redemption', '{"method": "qr"}'),
  pg_temp.op('00000000-0000-4000-8000-000000000075', 7, 'incident', '{"kind": "not_a_kind"}'),
  pg_temp.op('00000000-0000-4000-8000-000000000076', 8, 'redemption', pg_temp.scan('00000000-0000-4000-8000-000000000041'))
))::text, true);
SELECT is(
  (SELECT array_agg(r ->> 'status' ORDER BY n) FROM jsonb_array_elements(current_setting('test.mixed')::jsonb) WITH ORDINALITY AS t(r, n)),
  ARRAY['rejected', 'rejected', 'rejected', 'rejected', 'applied'],
  'malformed operations are rejected one by one and the good one is applied'
);
SELECT is(
  current_setting('test.mixed')::jsonb -> 0 ->> 'id',
  'not-a-uuid',
  'a rejection answers with the id the device sent'
);
SELECT ok(
  current_setting('test.mixed')::jsonb -> 1 ->> 'error' LIKE '22023:%',
  'a rejection carries the error code'
);
SELECT is(
  (SELECT count(*)::int FROM redemption.redemptions WHERE ticket_id = '00000000-0000-4000-8000-000000000041'),
  1,
  'the good operation of the batch was recorded'
);

-- ── Multi-scan tickets ───────────────────────────────────────────────────────
SELECT is(
  (SELECT array_agg(r ->> 'outcome' ORDER BY n) FROM jsonb_array_elements(
     redemption.apply_batch('00000000-0000-4000-8000-000000000030', jsonb_build_array(
       pg_temp.op('00000000-0000-4000-8000-000000000077', 9, 'staff_scan', pg_temp.scan('00000000-0000-4000-8000-000000000043')),
       pg_temp.op('00000000-0000-4000-8000-000000000078', 10, 'staff_scan', pg_temp.scan('00000000-0000-4000-8000-000000000043'))))
   ) WITH ORDINALITY AS t(r, n)),
  ARRAY['admitted', 'admitted'],
  'a multi-scan ticket is admitted every time'
);

-- ── Reconciliation incidents (8.11) ──────────────────────────────────────────
-- The single-use ticket 40, admitted on device 30, is scanned on device 31.
SELECT identity.set_actor('00000000-0000-4000-8000-00000000000c', 'staff');
SELECT is(
  redemption.apply_batch('00000000-0000-4000-8000-000000000031', jsonb_build_array(
    pg_temp.op('00000000-0000-4000-8000-000000000079', 1, 'redemption', pg_temp.scan('00000000-0000-4000-8000-000000000040')))) -> 0 ->> 'outcome',
  'duplicate',
  'the ticket admitted on another device is a duplicate here'
);

-- A scan of a ticket missing from the device's manifest.
SELECT is(
  redemption.apply_batch('00000000-0000-4000-8000-000000000031', jsonb_build_array(
    pg_temp.op('00000000-0000-4000-8000-00000000007a', 2, 'redemption', pg_temp.scan('00000000-0000-4000-8000-000000000042', false)))) -> 0 ->> 'outcome',
  'admitted',
  'a ticket missing from the manifest is still admitted'
);

-- The revoked device still uploads (I6); a scan after its revocation raises an incident,
-- one from before it does not.
SELECT identity.set_actor('00000000-0000-4000-8000-00000000000b', 'staff');
SELECT is(
  (SELECT array_agg(r ->> 'status' ORDER BY n) FROM jsonb_array_elements(
     redemption.apply_batch('00000000-0000-4000-8000-000000000032', jsonb_build_array(
       pg_temp.op('00000000-0000-4000-8000-00000000007b', 1, 'staff_scan', pg_temp.scan('00000000-0000-4000-8000-000000000043'), now() - interval '2 hours'),
       pg_temp.op('00000000-0000-4000-8000-00000000007c', 2, 'staff_scan', pg_temp.scan('00000000-0000-4000-8000-000000000043'), now())))
   ) WITH ORDINALITY AS t(r, n)),
  ARRAY['applied', 'applied'],
  'a revoked device still uploads what it recorded'
);

RESET SESSION AUTHORIZATION;

SELECT is(
  (SELECT array_agg(kind ORDER BY kind) FROM redemption.incidents WHERE source = 'reconciliation'),
  ARRAY['after_revocation', 'multi_device_redemption', 'out_of_manifest'],
  'reconciliation raises one incident of each kind'
);
SELECT is(
  (SELECT redemption_id FROM redemption.incidents WHERE kind = 'multi_device_redemption'),
  '00000000-0000-4000-8000-000000000079'::uuid,
  'the multi-device incident points at the second device''s scan'
);
SELECT is(
  (SELECT redemption_id FROM redemption.incidents WHERE kind = 'after_revocation'),
  '00000000-0000-4000-8000-00000000007c'::uuid,
  'only the scan after the revocation raises after_revocation'
);
SELECT is(
  (SELECT count(*)::int FROM redemption.incidents
    WHERE source = 'device' AND id = '00000000-0000-4000-8000-000000000072'),
  1,
  'the device incident is stored once'
);
SELECT throws_ok(
  $$ UPDATE redemption.incidents SET note = 'changed' WHERE id = '00000000-0000-4000-8000-000000000072' $$,
  NULL, NULL, 'incidents are append-only'
);

-- ── What the API reads ───────────────────────────────────────────────────────
SET LOCAL SESSION AUTHORIZATION passripple_api;
SELECT identity.set_actor('00000000-0000-4000-8000-00000000000c', 'staff');
SELECT is(
  (SELECT array_agg(kind ORDER BY kind) FROM redemption.incidents),
  ARRAY['multi_device_redemption', 'out_of_manifest'],
  'a staff member reads only the incidents of their own devices'
);
SELECT throws_ok(
  $$ INSERT INTO redemption.incidents (id, device_id, kind, source, device_seq, occurred_at_device)
     VALUES (gen_random_uuid(), '00000000-0000-4000-8000-000000000031', 'operator', 'device', 99, now()) $$,
  '42501', NULL, 'the API records incidents only through apply_batch'
);
RESET SESSION AUTHORIZATION;

SELECT * FROM finish(true);
ROLLBACK;
