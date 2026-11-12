-- Phase 8: emission authorization, live counts, deductible courtesies, the declaration's
-- figures and inspector mode. Canton M8-YES accepts digital tickets, M8-NO has not decided.
BEGIN;
SELECT plan(31);

-- ── Superuser setup ──────────────────────────────────────────────────────────
INSERT INTO jurisdictions.jurisdictions (canton_code, name, tax_rate_bps, courtesy_deduct_bps,
                                         settlement_rule, guarantee_bps, accepts_digital) VALUES
  ('M8-YES', 'Canton Yes', 500, '{"first": 500, "popular": 1000}', 'next_business_day', 6000, 'yes'),
  ('M8-NO', 'Canton Undecided', 500, '{}', 'next_business_day', NULL, 'unknown'),
  ('M8-OTH', 'Other Canton', 500, '{}', 'next_business_day', NULL, 'yes');
INSERT INTO identity.organizations (id, name, verified_at) VALUES
  ('00000000-0000-4000-8000-000000008a01', 'Org Eight', now()),
  ('00000000-0000-4000-8000-000000008a02', 'Org Other', now());
INSERT INTO identity.users (id, is_admin, email) VALUES
  ('00000000-0000-4000-8000-000000008b01', false, 'org8@example.test'),
  ('00000000-0000-4000-8000-000000008b02', false, 'official8@example.test'),
  ('00000000-0000-4000-8000-000000008b03', false, 'inspector8@example.test'),
  ('00000000-0000-4000-8000-000000008b04', false, 'otherofficial8@example.test'),
  ('00000000-0000-4000-8000-000000008b05', true, 'admin8@example.test'),
  ('00000000-0000-4000-8000-000000008b06', false, 'nobody8@example.test'),
  ('00000000-0000-4000-8000-000000008b07', false, 'orgother8@example.test');
INSERT INTO identity.memberships (org_id, user_id) VALUES
  ('00000000-0000-4000-8000-000000008a01', '00000000-0000-4000-8000-000000008b01'),
  ('00000000-0000-4000-8000-000000008a02', '00000000-0000-4000-8000-000000008b07');
INSERT INTO identity.inspectors (user_id, canton_code, kind) VALUES
  ('00000000-0000-4000-8000-000000008b02', 'M8-YES', 'official'),
  ('00000000-0000-4000-8000-000000008b03', 'M8-YES', 'inspector'),
  ('00000000-0000-4000-8000-000000008b04', 'M8-OTH', 'official');
INSERT INTO events.events (id, org_id, canton_code, name, venue_name, starts_at, ends_at, age_rating,
                           permitted_capacity, permit_number) VALUES
  ('00000000-0000-4000-8000-000000008e01', '00000000-0000-4000-8000-000000008a01', 'M8-YES', 'Ev Yes', 'Venue',
   now() + interval '10 days', now() + interval '11 days', 'all', 100, 'P-1'),
  ('00000000-0000-4000-8000-000000008e02', '00000000-0000-4000-8000-000000008a01', 'M8-NO', 'Ev Undecided', 'Venue',
   now() + interval '10 days', now() + interval '11 days', 'all', 100, 'P-2');
INSERT INTO catalog.ticket_types (id, event_id, name, price_crc) VALUES
  ('00000000-0000-4000-8000-000000008c01', '00000000-0000-4000-8000-000000008e01', 'General', 10000);
INSERT INTO ticketing.tickets (id, event_id, ticket_type_id, order_id, origin, code_human, status) VALUES
  ('00000000-0000-4000-8000-000000008d01', '00000000-0000-4000-8000-000000008e01', '00000000-0000-4000-8000-000000008c01',
   '00000000-0000-4000-8000-000000008f01', 'sale', 'M8AAAAAAAA', 'issued'),
  ('00000000-0000-4000-8000-000000008d02', '00000000-0000-4000-8000-000000008e01', '00000000-0000-4000-8000-000000008c01',
   '00000000-0000-4000-8000-000000008f01', 'sale', 'M8BBBBBBBB', 'issued'),
  ('00000000-0000-4000-8000-000000008d03', '00000000-0000-4000-8000-000000008e01', '00000000-0000-4000-8000-000000008c01',
   '00000000-0000-4000-8000-000000008f01', 'sale', 'M8CCCCCCCC', 'void'),
  ('00000000-0000-4000-8000-000000008d04', '00000000-0000-4000-8000-000000008e01', '00000000-0000-4000-8000-000000008c01',
   NULL, 'courtesy', 'M8DDDDDDDD', 'issued'),
  ('00000000-0000-4000-8000-000000008d05', '00000000-0000-4000-8000-000000008e01', '00000000-0000-4000-8000-000000008c01',
   NULL, 'courtesy', 'M8EEEEEEEE', 'issued');

SET LOCAL SESSION AUTHORIZATION passripple_api;

-- ── Municipal accounts ───────────────────────────────────────────────────────
SELECT lives_ok($$ SELECT identity.set_actor('00000000-0000-4000-8000-000000008b03', 'inspector') $$,
  'a user with municipal access acts as inspector');
SELECT throws_ok($$ SELECT identity.set_actor('00000000-0000-4000-8000-000000008b06', 'inspector') $$,
  '42501', NULL, 'a user without municipal access cannot act as inspector');
SELECT throws_ok($$ SELECT identity.grant_inspector('x@example.test', 'M8-YES', 'official') $$,
  '42501', NULL, 'only an administrator grants municipal access');
SELECT identity.set_actor('00000000-0000-4000-8000-000000008b05', 'admin');
SELECT isnt((SELECT identity.grant_inspector('Fresh8@Example.test', 'M8-YES', 'inspector')), NULL,
  'an administrator grants access by email, creating the account');
SELECT is_empty($$ SELECT * FROM identity.session_profile(sha256('none')) $$,
  'an unknown session has no profile');

-- ── Authorization: portal variant ────────────────────────────────────────────
SELECT identity.set_actor('00000000-0000-4000-8000-000000008b01', 'organizer', '00000000-0000-4000-8000-000000008a01');
SELECT throws_ok($$ SELECT events.publish('00000000-0000-4000-8000-000000008e01') $$,
  '55000', NULL, 'a canton that accepts digital tickets blocks publishing without authorization');
SELECT throws_ok($$ SELECT municipal.request_authorization('00000000-0000-4000-8000-000000008e01', 'document', 'SELLO') $$,
  '55000', NULL, 'the document variant is not for a canton with a portal');
SELECT isnt((SELECT municipal.request_authorization('00000000-0000-4000-8000-000000008e01', 'portal')), NULL,
  'the organizer asks for the authorization');
SELECT throws_ok($$ SELECT municipal.request_authorization('00000000-0000-4000-8000-000000008e01', 'portal') $$,
  '55000', NULL, 'a second request while one is open is rejected');
SELECT throws_ok(
  $$ SELECT municipal.decide((SELECT authorization_id FROM municipal.authorizations_list() LIMIT 1), true) $$,
  '42501', NULL, 'an organizer cannot decide');

SELECT identity.set_actor('00000000-0000-4000-8000-000000008b03', 'inspector');
SELECT throws_ok(
  $$ SELECT municipal.decide((SELECT authorization_id FROM municipal.authorizations_list() LIMIT 1), true) $$,
  '42501', NULL, 'an inspector who is not an official cannot decide');

SELECT identity.set_actor('00000000-0000-4000-8000-000000008b04', 'inspector');
SELECT is((SELECT count(*)::int FROM municipal.authorizations_list()), 0,
  'an official of another canton sees no authorizations of this one');

SELECT identity.set_actor('00000000-0000-4000-8000-000000008b02', 'inspector');
SELECT is((SELECT count(*)::int FROM municipal.authorizations_list() WHERE status = 'requested'), 1,
  'the official sees the pending request');
SELECT matches(
  (SELECT municipal.decide((SELECT authorization_id FROM municipal.authorizations_list() LIMIT 1), true, 'ok')),
  '^AUT-M8-YES-[0-9]{4}-[0-9A-F]{8}$', 'approving gives the authorization reference');
SELECT is((SELECT guarantee_crc FROM municipal.authorizations_list() LIMIT 1), 30000,
  'the guarantee is the share of the estimated tax: 100 x 10.000 x 5% x 60%');

SELECT identity.set_actor('00000000-0000-4000-8000-000000008b01', 'organizer', '00000000-0000-4000-8000-000000008a01');
SELECT lives_ok($$ SELECT events.publish('00000000-0000-4000-8000-000000008e01') $$,
  'with the authorization the event can be published');

-- ── Authorization: document variant ──────────────────────────────────────────
SELECT lives_ok($$ SELECT municipal.request_authorization('00000000-0000-4000-8000-000000008e02', 'document', 'SELLO-77') $$,
  'where the canton has no portal the organizer records its own authorization');
SELECT is((SELECT status FROM municipal.authorizations_list() WHERE event_name = 'Ev Undecided'), 'authorized',
  'the document variant is authorized right away');

-- ── Counts, courtesies, declaration ──────────────────────────────────────────
SELECT identity.set_actor('00000000-0000-4000-8000-000000008b03', 'inspector');
SELECT is((SELECT municipal.live_counts('00000000-0000-4000-8000-000000008e01')::jsonb ->> 'soldOnline'), '2',
  'the live count has the online sales');
SELECT is((SELECT municipal.live_counts('00000000-0000-4000-8000-000000008e01')::jsonb ->> 'voided'), '1',
  'the live count has the voided tickets');
SELECT is((SELECT municipal.courtesy_deductible('00000000-0000-4000-8000-000000008e01')::jsonb ->> 'excess'), '2',
  'courtesies above the stricter limit (5% of 4 entries) are excess');
SELECT is(
  (SELECT municipal.declaration_figures('00000000-0000-4000-8000-000000008e01')::jsonb #>> '{types,0,online}'),
  '2', 'the declaration counts online sales per type');
SELECT is(
  (SELECT length(municipal.declaration_figures('00000000-0000-4000-8000-000000008e01')::jsonb ->> 'logHash')), 64,
  'the declaration carries the hash of the event record');
SELECT is((SELECT municipal.verify_ticket('m8-aaaaaaaa')::jsonb ->> 'reason'), 'ok',
  'the inspector verifies a ticket by its human code');
SELECT is((SELECT municipal.verify_ticket('M8CCCCCCCC')::jsonb ->> 'reason'), 'void', 'a voided ticket is reported');

SELECT identity.set_actor('00000000-0000-4000-8000-000000008b04', 'inspector');
SELECT throws_ok($$ SELECT municipal.live_counts('00000000-0000-4000-8000-000000008e01') $$,
  '42501', NULL, 'an official of another canton cannot read the count');
SELECT is((SELECT municipal.verify_ticket('M8AAAAAAAA')::jsonb ->> 'reason'), 'unknown',
  'a ticket of another canton looks like a code that does not exist');

SELECT identity.set_actor('00000000-0000-4000-8000-000000008b07', 'organizer', '00000000-0000-4000-8000-000000008a02');
SELECT throws_ok($$ SELECT municipal.declaration_figures('00000000-0000-4000-8000-000000008e01') $$,
  '42501', NULL, 'another organization cannot read the declaration');
SELECT throws_ok($$ SELECT municipal.verify_ticket('M8AAAAAAAA') $$,
  '42501', NULL, 'organizers cannot use inspector mode');

SELECT identity.set_actor('00000000-0000-4000-8000-000000008b01', 'organizer', '00000000-0000-4000-8000-000000008a01');
SELECT is((SELECT municipal.courtesy_deductible('00000000-0000-4000-8000-000000008e01')::jsonb ->> 'courtesies'), '2',
  'the organizer sees its own courtesy alert');

RESET SESSION AUTHORIZATION;
SELECT is((SELECT emission_auth FROM events.events WHERE id = '00000000-0000-4000-8000-000000008e02'), 'SELLO-77',
  'the document reference is on the event');

SELECT * FROM finish(true);
ROLLBACK;
