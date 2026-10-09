BEGIN;
SELECT plan(13);

-- ── Superuser setup ──────────────────────────────────────────────────────────
INSERT INTO identity.organizations (id, name, verified_at) VALUES
  ('00000000-0000-4000-8000-00000000000a', 'Org 1', now()),
  ('00000000-0000-4000-8000-00000000000b', 'Org 2', now());

INSERT INTO identity.users (id, is_admin) VALUES
  ('00000000-0000-4000-8000-00000000000c', false),
  ('00000000-0000-4000-8000-00000000000d', false);

INSERT INTO identity.memberships (org_id, user_id) VALUES
  ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000c'),
  ('00000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-00000000000d');

INSERT INTO jurisdictions.jurisdictions (canton_code, name, tax_rate_bps, courtesy_deduct_bps, settlement_rule) VALUES
  ('TEST-01', 'Test', 0, '{}', 'next_business_day');

INSERT INTO events.events (id, org_id, canton_code, name, venue_name, starts_at, age_rating, permitted_capacity, status, published_at) VALUES
  ('00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-00000000000a', 'TEST-01', 'Event 1', 'Venue', now(), 'all', 10, 'on_sale', now()),
  ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-00000000000a', 'TEST-01', 'Event 2', 'Venue', now(), 'all', 10, 'closed', now());

-- ── API actions ──────────────────────────────────────────────────────────────
SET LOCAL SESSION AUTHORIZATION passripple_api;
SELECT identity.set_actor('00000000-0000-4000-8000-00000000000c', 'organizer');

-- direct DML
SELECT throws_ok(
  $$ INSERT INTO courtesy.event_quotas (event_id, declared_quota) VALUES ('00000000-0000-4000-8000-000000000010', 10) $$,
  '42501', NULL, 'API cannot DML event_quotas directly'
);
SELECT throws_ok(
  $$ INSERT INTO courtesy.grants (event_id, quantity, granted_by) VALUES ('00000000-0000-4000-8000-000000000010', 1, '00000000-0000-4000-8000-00000000000c') $$,
  '42501', NULL, 'API cannot DML grants directly'
);

-- set quota
SELECT lives_ok(
  $$ SELECT courtesy.declare_quota('00000000-0000-4000-8000-000000000010', 10) $$,
  'organizer can declare quota'
);

-- grant tickets
SELECT is(
  (SELECT courtesy.grant_tickets('00000000-0000-4000-8000-000000000010', 8) IS NOT NULL),
  true,
  'organizer can grant tickets within quota'
);

-- grant more than quota
SELECT is(
  (SELECT courtesy.grant_tickets('00000000-0000-4000-8000-000000000010', 3)),
  NULL,
  'granting more than quota returns NULL'
);

-- lower quota below granted
SELECT throws_ok(
  $$ SELECT courtesy.declare_quota('00000000-0000-4000-8000-000000000010', 5) $$,
  '23514', NULL, 'lowering quota below granted raises check_violation'
);

-- closed event
SELECT throws_ok(
  $$ SELECT courtesy.declare_quota('00000000-0000-4000-8000-000000000011', 10) $$,
  '42501', NULL, 'cannot declare quota for closed event'
);
SELECT throws_ok(
  $$ SELECT courtesy.grant_tickets('00000000-0000-4000-8000-000000000011', 1) $$,
  '42501', NULL, 'cannot grant tickets for closed event'
);

-- other organizer
SELECT identity.set_actor('00000000-0000-4000-8000-00000000000d', 'organizer');
SELECT throws_ok(
  $$ SELECT courtesy.declare_quota('00000000-0000-4000-8000-000000000010', 10) $$,
  '42501', NULL, 'other organizer cannot declare quota'
);
SELECT throws_ok(
  $$ SELECT courtesy.grant_tickets('00000000-0000-4000-8000-000000000010', 1) $$,
  '42501', NULL, 'other organizer cannot grant tickets'
);

-- ── Owner actions ────────────────────────────────────────────────────────────
RESET SESSION AUTHORIZATION;
SET LOCAL ROLE passripple_owner_courtesy;

-- we need the grant id
DO $$
DECLARE g uuid;
BEGIN
  SELECT id INTO g FROM courtesy.grants LIMIT 1;
  PERFORM set_config('app.test_g', g::text, true);
END $$;

SELECT throws_ok(
  $$ UPDATE courtesy.grants SET quantity = 100 WHERE id = current_setting('app.test_g')::uuid $$,
  '23001', NULL, 'owner cannot UPDATE grants'
);
SELECT throws_ok(
  $$ DELETE FROM courtesy.grants WHERE id = current_setting('app.test_g')::uuid $$,
  '23001', NULL, 'owner cannot DELETE grants'
);
SELECT throws_ok(
  $$ TRUNCATE courtesy.grants $$,
  '23001', NULL, 'owner cannot TRUNCATE grants'
);
RESET ROLE;

SELECT * FROM finish(true);
ROLLBACK;





