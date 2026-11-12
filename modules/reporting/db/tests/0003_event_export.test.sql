-- Phase 10: the organizer's export has one row per issued ticket, no personal data, and
-- only the event's own organization (or an administrator) reads it.
BEGIN;
SELECT plan(7);

INSERT INTO identity.organizations (id, name, verified_at) VALUES
  ('00000000-0000-4000-8000-0000000010a1', 'Export Org', now()),
  ('00000000-0000-4000-8000-0000000010a2', 'Other Org', now());
INSERT INTO identity.users (id, is_admin) VALUES
  ('00000000-0000-4000-8000-0000000010b1', false),
  ('00000000-0000-4000-8000-0000000010b2', false);
INSERT INTO identity.memberships (org_id, user_id) VALUES
  ('00000000-0000-4000-8000-0000000010a1', '00000000-0000-4000-8000-0000000010b1'),
  ('00000000-0000-4000-8000-0000000010a2', '00000000-0000-4000-8000-0000000010b2');
INSERT INTO jurisdictions.jurisdictions (canton_code, name, tax_rate_bps, courtesy_deduct_bps, settlement_rule) VALUES
  ('EXP-01', 'Export Canton', 0, '{}', 'next_business_day');
INSERT INTO events.events (id, org_id, canton_code, name, venue_name, starts_at, age_rating, permitted_capacity, status, published_at) VALUES
  ('00000000-0000-4000-8000-0000000010e1', '00000000-0000-4000-8000-0000000010a1', 'EXP-01', 'Export Event', 'Venue', now(), 'all', 10, 'on_sale', now());
INSERT INTO catalog.ticket_types (id, event_id, name, zone, price_crc) VALUES
  ('00000000-0000-4000-8000-0000000010c1', '00000000-0000-4000-8000-0000000010e1', 'General', 'sun', 3000);
INSERT INTO ticketing.tickets (id, event_id, ticket_type_id, order_id, origin, code_human, status, created_at) VALUES
  ('00000000-0000-4000-8000-0000000010d1', '00000000-0000-4000-8000-0000000010e1', '00000000-0000-4000-8000-0000000010c1',
   '00000000-0000-4000-8000-0000000010f1', 'sale', 'EXPAAAAA11', 'issued', now() - interval '3 minutes'),
  ('00000000-0000-4000-8000-0000000010d2', '00000000-0000-4000-8000-0000000010e1', '00000000-0000-4000-8000-0000000010c1',
   NULL, 'courtesy', 'EXPAAAAA22', 'issued', now() - interval '2 minutes'),
  ('00000000-0000-4000-8000-0000000010d3', '00000000-0000-4000-8000-0000000010e1', '00000000-0000-4000-8000-0000000010c1',
   NULL, 'door_sale', 'EXPAAAAA33', 'unsold', now() - interval '1 minute');

SET LOCAL SESSION AUTHORIZATION passripple_api;
SELECT identity.set_actor('00000000-0000-4000-8000-0000000010b1', 'organizer', '00000000-0000-4000-8000-0000000010a1');

SELECT is((SELECT count(*)::int FROM reporting.event_export('00000000-0000-4000-8000-0000000010e1')), 2,
  'one row per issued ticket; unsold door-sale stock is left out');
SELECT is((SELECT array_agg(seq ORDER BY seq) FROM reporting.event_export('00000000-0000-4000-8000-0000000010e1')),
  ARRAY[1, 2], 'rows are numbered in issue order');
SELECT is((SELECT code_tail FROM reporting.event_export('00000000-0000-4000-8000-0000000010e1') WHERE seq = 1),
  'AA11', 'a ticket shows only the last four characters of its code');
SELECT is((SELECT price_crc FROM reporting.event_export('00000000-0000-4000-8000-0000000010e1') WHERE seq = 2), 0,
  'a courtesy is exported at price zero');
SELECT is((SELECT price_crc FROM reporting.event_export('00000000-0000-4000-8000-0000000010e1') WHERE seq = 1), 3000,
  'a sale is exported at its price');
SELECT is((SELECT admitted_at FROM reporting.event_export('00000000-0000-4000-8000-0000000010e1') WHERE seq = 1), NULL,
  'a ticket nobody has used has no admission time');

SELECT identity.set_actor('00000000-0000-4000-8000-0000000010b2', 'organizer', '00000000-0000-4000-8000-0000000010a2');
SELECT throws_ok($$ SELECT * FROM reporting.event_export('00000000-0000-4000-8000-0000000010e1') $$,
  '42501', NULL, 'another organization cannot export the event');

SELECT * FROM finish(true);
ROLLBACK;
