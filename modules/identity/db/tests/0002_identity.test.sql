BEGIN;
SELECT plan(12);

-- ── Superuser setup ──────────────────────────────────────────────────────────
INSERT INTO identity.organizations (id, name) VALUES
  ('00000000-0000-4000-8000-00000000000c', 'Org 1');

INSERT INTO identity.users (id, is_admin, disabled_at) VALUES
  ('00000000-0000-4000-8000-00000000000a', true, NULL),
  ('00000000-0000-4000-8000-00000000000b', false, NULL),
  ('00000000-0000-4000-8000-00000000000d', false, now()),
  ('00000000-0000-4000-8000-00000000000e', false, NULL);

INSERT INTO identity.memberships (org_id, user_id, revoked_at) VALUES
  ('00000000-0000-4000-8000-00000000000c', '00000000-0000-4000-8000-00000000000b', NULL),
  ('00000000-0000-4000-8000-00000000000c', '00000000-0000-4000-8000-00000000000e', now());

-- ── API actions ──────────────────────────────────────────────────────────────
SET LOCAL SESSION AUTHORIZATION passripple_api;

SELECT throws_ok(
  $$ SELECT identity.set_actor('00000000-0000-4000-8000-00000000000a', 'unknown_role') $$,
  '22023', NULL, 'set_actor rejects unknown role'
);
SELECT throws_ok(
  $$ SELECT identity.set_actor('00000000-0000-4000-8000-00000000000f', 'admin') $$,
  '42501', NULL, 'set_actor rejects non-existent user'
);
SELECT throws_ok(
  $$ SELECT identity.set_actor('00000000-0000-4000-8000-00000000000d', 'admin') $$,
  '42501', NULL, 'set_actor rejects disabled user'
);
SELECT throws_ok(
  $$ SELECT identity.set_actor('00000000-0000-4000-8000-00000000000b', 'admin') $$,
  '42501', NULL, 'set_actor rejects non-admin user for admin role'
);
SELECT throws_ok(
  $$ SELECT identity.set_actor('00000000-0000-4000-8000-00000000000b', 'organizer', '00000000-0000-4000-8000-00000000000a') $$,
  '42501', NULL, 'set_actor rejects organizer without membership'
);
SELECT throws_ok(
  $$ SELECT identity.set_actor('00000000-0000-4000-8000-00000000000e', 'organizer', '00000000-0000-4000-8000-00000000000c') $$,
  '42501', NULL, 'set_actor rejects organizer with revoked membership'
);
SELECT throws_ok(
  $$ SELECT identity.set_actor('00000000-0000-4000-8000-00000000000a', 'buyer') $$,
  '22023', NULL, 'set_actor rejects buyer with actor_id'
);
SELECT throws_ok(
  $$ SELECT identity.set_actor(NULL, 'system', '00000000-0000-4000-8000-00000000000c') $$,
  '22023', NULL, 'set_actor rejects system with org_id'
);
SELECT throws_ok(
  $$ SELECT identity.set_actor('00000000-0000-4000-8000-00000000000a', 'admin', '00000000-0000-4000-8000-00000000000c') $$,
  '22023', NULL, 'set_actor rejects org_id for non-organizer role'
);

-- Test set_organization_verified
SELECT identity.set_actor('00000000-0000-4000-8000-00000000000b', 'organizer', '00000000-0000-4000-8000-00000000000c');

SELECT throws_ok(
  $$ SELECT identity.set_organization_verified('00000000-0000-4000-8000-00000000000c', true) $$,
  '42501', NULL, 'only an admin can verify an organization'
);

-- Test successful cases
SELECT identity.set_actor('00000000-0000-4000-8000-00000000000a', 'admin');
SELECT lives_ok(
  $$ SELECT identity.set_organization_verified('00000000-0000-4000-8000-00000000000c', true) $$,
  'admin can verify an organization'
);

SELECT identity.set_actor(NULL, 'buyer');
SELECT lives_ok(
  $$ SELECT 1 $$, 'buyer with null id and org lives'
);

RESET SESSION AUTHORIZATION;
SELECT * FROM finish(true);
ROLLBACK;
