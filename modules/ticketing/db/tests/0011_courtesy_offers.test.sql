BEGIN;
SELECT plan(12);

-- ── Superuser setup: 10 seats, 2 courtesies declared ────────────────────────
INSERT INTO identity.organizations (id, name, verified_at) VALUES
  ('00000000-0000-4000-8000-00000000000a', 'Org 1', now());
INSERT INTO jurisdictions.jurisdictions (canton_code, name, tax_rate_bps, courtesy_deduct_bps, settlement_rule) VALUES
  ('TEST-01', 'Test', 0, '{}', 'next_business_day');
INSERT INTO events.events (id, org_id, canton_code, name, venue_name, starts_at, age_rating, permitted_capacity, status, published_at) VALUES
  ('00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-00000000000a', 'TEST-01', 'Gala', 'Venue', now() + interval '2 days', 'all', 10, 'on_sale', now());
INSERT INTO catalog.ticket_types (id, event_id, name, price_crc, audience, entry_mode) VALUES
  ('00000000-0000-4000-8000-000000000020', '00000000-0000-4000-8000-000000000010', 'General', 5000, 'public', 'single_use');
INSERT INTO inventory.event_capacity (event_id, permitted_capacity, committed) VALUES
  ('00000000-0000-4000-8000-000000000010', 10, 0);
INSERT INTO courtesy.event_quotas (event_id, declared_quota) VALUES
  ('00000000-0000-4000-8000-000000000010', 2);

-- ── 1. The organizer's grant counts against the quota (I3) ──────────────────
SELECT set_config('app.actor_role', 'organizer', true);
SELECT set_config('app.org_id', '00000000-0000-4000-8000-00000000000a', true);
SELECT set_config('app.actor_id', '00000000-0000-4000-8000-00000000000b', true);
SELECT isnt(courtesy.grant_tickets('00000000-0000-4000-8000-000000000010', 1), NULL,
            'a courtesy within the quota is granted');
SELECT is(courtesy.grant_tickets('00000000-0000-4000-8000-000000000010', 2), NULL,
          'beyond the declared quota nothing is granted');

-- ── 2. Then, as the system, its seat and its ticket ─────────────────────────
SELECT set_config('app.actor_role', 'system', true);
SELECT is(inventory.commit_courtesy('00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000020', 1),
          true, 'the courtesy takes a seat (I2)');
SELECT is(inventory.commit_courtesy('00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000020', 10),
          false, 'seats that do not fit are refused');
CREATE TEMP TABLE gift AS
  SELECT ticketing.issue('00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000020',
                         NULL, 'courtesy', 'C0RT500001') AS id;
SELECT lives_ok(
  $$SELECT ticketing.offer_courtesy((SELECT id FROM gift), 'prx_courtesy_link_0000000000000001', interval '7 days')$$,
  'the unbound courtesy gets a claim link');
SELECT throws_ok(
  $$SELECT ticketing.offer_courtesy((SELECT id FROM gift), 'short', interval '7 days')$$,
  '22023', NULL, 'the link token must be long');

SELECT is((SELECT state FROM ticketing.transfer_offer('prx_courtesy_link_0000000000000001')), 'open',
          'the receiver''s preview says the courtesy link is open');

-- ── 3. The receiver claims it on their phone ────────────────────────────────
SELECT is(ticketing.claim_transfer('prx_courtesy_link_0000000000000001', decode(repeat('33', 32), 'hex'),
                                   'prh_courtesy_holder_000000000000001'),
          1::smallint, 'claiming binds the courtesy to the receiver''s key');
SELECT is((SELECT status FROM ticketing.tickets WHERE id = (SELECT id FROM gift)), 'bound',
          'the ticket is bound');
SELECT is((SELECT state FROM ticketing.transfer_offer('prx_courtesy_link_0000000000000001')), 'claimed',
          'once claimed, the preview says so');
SELECT throws_ok(
  $$SELECT ticketing.claim_transfer('prx_courtesy_link_0000000000000001', decode(repeat('44', 32), 'hex'),
                                    'prh_courtesy_holder_000000000000002')$$,
  '55000', NULL, 'the link works once');
SELECT throws_ok(
  $$SELECT ticketing.offer_courtesy((SELECT id FROM gift), 'prx_courtesy_link_0000000000000002', interval '7 days')$$,
  '22023', NULL, 'a claimed courtesy gets no new link');

SELECT * FROM finish();
ROLLBACK;
