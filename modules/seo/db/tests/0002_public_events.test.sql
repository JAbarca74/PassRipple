BEGIN;
SELECT plan(5);

-- ── Superuser setup ──────────────────────────────────────────────────────────
INSERT INTO identity.organizations (id, name, verified_at) VALUES
  ('00000000-0000-4000-8000-0000000008a1', 'Asociación Ejemplo', now());
INSERT INTO jurisdictions.jurisdictions (canton_code, name, tax_rate_bps, courtesy_deduct_bps, settlement_rule)
  VALUES ('TEST-08', 'Pérez Zeledón', 0, '{}', 'next_business_day');
INSERT INTO events.events (id, org_id, canton_code, name, venue_name, slug, starts_at, ends_at, age_rating, permitted_capacity, status, published_at) VALUES
  ('00000000-0000-4000-8000-0000000008e1', '00000000-0000-4000-8000-0000000008a1', 'TEST-08', 'Motocross', 'Finca El Llano', 'motocross-pz', now() + interval '5 days', now() + interval '6 days', 'all', 100, 'on_sale', now() - interval '1 day'),
  ('00000000-0000-4000-8000-0000000008e2', '00000000-0000-4000-8000-0000000008a1', 'TEST-08', 'Borrador', 'Venue', 'borrador-pz', now() + interval '5 days', now() + interval '6 days', 'all', 100, 'draft', NULL),
  ('00000000-0000-4000-8000-0000000008e3', '00000000-0000-4000-8000-0000000008a1', 'TEST-08', 'Viejo', 'Venue', 'viejo-pz', now() - interval '60 days', now() - interval '59 days', 'all', 100, 'closed', now() - interval '90 days'),
  ('00000000-0000-4000-8000-0000000008e4', '00000000-0000-4000-8000-0000000008a1', 'TEST-08', 'Cancelado', 'Venue', 'cancelado-pz', now() + interval '2 days', now() + interval '3 days', '18plus', 100, 'cancelled', now() - interval '3 days');
INSERT INTO catalog.ticket_types (event_id, name, price_crc, audience) VALUES
  ('00000000-0000-4000-8000-0000000008e1', 'General', 5000, 'public'),
  ('00000000-0000-4000-8000-0000000008e1', 'VIP', 12000, 'public'),
  ('00000000-0000-4000-8000-0000000008e1', 'Prensa', 0, 'staff');

SET LOCAL SESSION AUTHORIZATION passripple_api;
SELECT identity.set_actor(NULL, 'buyer');

SELECT results_eq(
  $$ SELECT slug FROM seo.public_events() $$,
  $$ VALUES ('cancelado-pz'::text), ('motocross-pz'::text) $$,
  'only published events, not over for more than 30 days, by start'
);

SELECT results_eq(
  $$ SELECT name, venue_name, locality, organizer_name, status, from_price_crc
       FROM seo.public_events('motocross-pz') $$,
  $$ VALUES ('Motocross'::text, 'Finca El Llano'::text, 'Pérez Zeledón'::text,
             'Asociación Ejemplo'::text, 'on_sale'::text, 5000) $$,
  'an event carries its locality, organizer and lowest public price'
);

SELECT is(
  (SELECT from_price_crc FROM seo.public_events('cancelado-pz')),
  NULL, 'an event without public ticket types has no price'
);

SELECT is_empty(
  $$ SELECT * FROM seo.public_events('borrador-pz') $$,
  'a draft is never public'
);

SELECT is_empty(
  $$ SELECT * FROM seo.public_events('no-existe') $$,
  'an unknown slug returns nothing'
);

SELECT * FROM finish();
ROLLBACK;
