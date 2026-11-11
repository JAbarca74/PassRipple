-- Load-test data (design 9.8). Run as the database owner on a throwaway database or a Neon
-- test branch, NEVER on production. Everything is fictitious and marked "load".
--
--   carga-a       the big on-sale: 10,000 seats, one public type at 5,000 colones
--   carga-b       a second event selling at the same time, to measure isolation (2,000 seats)
--   carga-puerta  the gate event: 5,000 issued tickets and 100 enrolled gate devices
--
-- Ticket ids of carga-puerta are 10adc000-0000-4000-8000-<n in hex, 12 digits>, device ids
-- 10add000-... the same way, and device tokens are
-- 'prd_load-device-<n>', so the k6 scripts can rebuild them without reading the database.
-- Running it twice is harmless.

\set ON_ERROR_STOP on
BEGIN;

INSERT INTO jurisdictions.jurisdictions (canton_code, name, tax_rate_bps, courtesy_deduct_bps, settlement_rule)
VALUES ('dev', 'Development canton', 500, '{}', 'next_business_day')
ON CONFLICT DO NOTHING;

INSERT INTO identity.organizations (id, name, verified_at)
VALUES ('10ad0000-0000-4000-8000-000000000001', 'Load test organization', now())
ON CONFLICT DO NOTHING;

INSERT INTO identity.users (email)
SELECT 'load-staff-' || n || '@load.test' FROM generate_series(1, 100) AS n
ON CONFLICT DO NOTHING;

INSERT INTO events.events (id, org_id, canton_code, name, venue_name, starts_at, ends_at,
                           age_rating, permitted_capacity)
VALUES
  ('10ad0000-0000-4000-8000-00000000000a', '10ad0000-0000-4000-8000-000000000001', 'dev',
   'Carga A', 'Estadio de carga', now() + interval '7 days', now() + interval '8 days', 'all', 10000),
  ('10ad0000-0000-4000-8000-00000000000b', '10ad0000-0000-4000-8000-000000000001', 'dev',
   'Carga B', 'Teatro de carga', now() + interval '7 days', now() + interval '8 days', 'all', 2000),
  ('10ad0000-0000-4000-8000-00000000000c', '10ad0000-0000-4000-8000-000000000001', 'dev',
   'Carga puerta', 'Puerta de carga', now() - interval '1 hour', now() + interval '1 day', 'all', 5000)
ON CONFLICT DO NOTHING;

UPDATE events.events
   SET status = 'on_sale', published_at = coalesce(published_at, now()),
       permit_number = 'LOAD-' || right(id::text, 1),
       slug = CASE right(id::text, 1) WHEN 'a' THEN 'carga-a' WHEN 'b' THEN 'carga-b'
                                      ELSE 'carga-puerta' END
 WHERE id IN ('10ad0000-0000-4000-8000-00000000000a', '10ad0000-0000-4000-8000-00000000000b',
              '10ad0000-0000-4000-8000-00000000000c');

INSERT INTO privacy.legal_documents (kind, version, content_sha256)
SELECT kind, 'dev-1', sha256(convert_to('PassRipple development ' || kind, 'UTF8'))
  FROM unnest(ARRAY['terms', 'privacy']) AS kind
ON CONFLICT DO NOTHING;

INSERT INTO catalog.ticket_types (id, event_id, name, price_crc, audience, entry_mode)
VALUES
  ('10ad0000-0000-4000-8000-0000000000a1', '10ad0000-0000-4000-8000-00000000000a', 'General', 5000, 'public', 'single_use'),
  ('10ad0000-0000-4000-8000-0000000000b1', '10ad0000-0000-4000-8000-00000000000b', 'General', 5000, 'public', 'single_use'),
  ('10ad0000-0000-4000-8000-0000000000c1', '10ad0000-0000-4000-8000-00000000000c', 'General', 5000, 'public', 'single_use')
ON CONFLICT DO NOTHING;

SELECT identity.set_actor(NULL, 'system', NULL);
SELECT inventory.apply_event_published(id)
  FROM events.events
 WHERE org_id = '10ad0000-0000-4000-8000-000000000001'
   AND NOT EXISTS (SELECT 1 FROM inventory.event_capacity c WHERE c.event_id = events.events.id);

-- The gate event's tickets, issued directly with known ids. Codes: 'GT' and 8 digits.
INSERT INTO ticketing.tickets (id, event_id, ticket_type_id, order_id, origin, code_human, entry_mode)
SELECT ('10adc000-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid, '10ad0000-0000-4000-8000-00000000000c',
       '10ad0000-0000-4000-8000-0000000000c1', gen_random_uuid(), 'sale',
       'GT' || lpad(n::text, 8, '0'), 'single_use'
  FROM generate_series(1, 5000) AS n
ON CONFLICT DO NOTHING;

-- 100 gate devices, one per staff member, each with a session token known to the scripts.
INSERT INTO staff.staff_devices (id, event_id, user_id, role, valid_from, valid_until)
SELECT ('10add000-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid, '10ad0000-0000-4000-8000-00000000000c', u.id, 'gate',
       now() - interval '1 day', now() + interval '2 days'
  FROM generate_series(1, 100) AS n
  JOIN identity.users u ON u.email = 'load-staff-' || n || '@load.test'
ON CONFLICT DO NOTHING;

INSERT INTO staff.device_sessions (token_hash, device_id)
SELECT sha256(convert_to('prd_load-device-' || n, 'UTF8')), ('10add000-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid
  FROM generate_series(1, 100) AS n
ON CONFLICT DO NOTHING;

COMMIT;

SELECT e.slug, c.permitted_capacity, c.committed
  FROM events.events e JOIN inventory.event_capacity c ON c.event_id = e.id
 WHERE e.org_id = '10ad0000-0000-4000-8000-000000000001'
 ORDER BY e.slug;
