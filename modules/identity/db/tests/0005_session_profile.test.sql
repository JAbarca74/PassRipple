BEGIN;
SELECT plan(6);

-- ── Superuser setup ──────────────────────────────────────────────────────────
INSERT INTO identity.organizations (id, name, verified_at) VALUES
  ('00000000-0000-4000-8000-0000000005a1', 'Beta', now()),
  ('00000000-0000-4000-8000-0000000005a2', 'Alfa', now()),
  ('00000000-0000-4000-8000-0000000005a3', 'Gamma', now());
INSERT INTO identity.users (id, is_admin) VALUES
  ('00000000-0000-4000-8000-0000000005b1', false),
  ('00000000-0000-4000-8000-0000000005b2', true);
INSERT INTO identity.memberships (org_id, user_id, revoked_at) VALUES
  ('00000000-0000-4000-8000-0000000005a1', '00000000-0000-4000-8000-0000000005b1', NULL),
  ('00000000-0000-4000-8000-0000000005a2', '00000000-0000-4000-8000-0000000005b1', NULL),
  ('00000000-0000-4000-8000-0000000005a3', '00000000-0000-4000-8000-0000000005b1', now());
INSERT INTO identity.user_sessions (token_hash, user_id, expires_at, ended_at) VALUES
  (sha256('organizer'), '00000000-0000-4000-8000-0000000005b1', now() + interval '1 hour', NULL),
  (sha256('admin'), '00000000-0000-4000-8000-0000000005b2', now() + interval '1 hour', NULL),
  (sha256('ended'), '00000000-0000-4000-8000-0000000005b1', now() + interval '1 hour', now());
INSERT INTO identity.user_sessions (token_hash, user_id, created_at, expires_at) VALUES
  (sha256('expired'), '00000000-0000-4000-8000-0000000005b1', now() - interval '2 hours', now() - interval '1 hour');

SET LOCAL SESSION AUTHORIZATION passripple_api;

SELECT results_eq(
  $$ SELECT user_id, is_admin, organizations FROM identity.session_profile(sha256('organizer')) $$,
  $$ VALUES ('00000000-0000-4000-8000-0000000005b1'::uuid, false,
             '[{"id": "00000000-0000-4000-8000-0000000005a2", "name": "Alfa"},
               {"id": "00000000-0000-4000-8000-0000000005a1", "name": "Beta"}]'::jsonb) $$,
  'an organizer gets their organizations by name, without revoked memberships'
);

SELECT results_eq(
  $$ SELECT is_admin, organizations FROM identity.session_profile(sha256('admin')) $$,
  $$ VALUES (true, '[]'::jsonb) $$,
  'an administrator without memberships gets an empty list'
);

SELECT is_empty(
  $$ SELECT * FROM identity.session_profile(sha256('ended')) $$,
  'an ended session has no profile'
);

SELECT is_empty(
  $$ SELECT * FROM identity.session_profile(sha256('expired')) $$,
  'an expired session has no profile'
);

SELECT is_empty(
  $$ SELECT * FROM identity.session_profile(sha256('unknown')) $$,
  'an unknown token has no profile'
);

RESET SESSION AUTHORIZATION;
UPDATE identity.users SET disabled_at = now() WHERE id = '00000000-0000-4000-8000-0000000005b1';
SET LOCAL SESSION AUTHORIZATION passripple_api;
SELECT is_empty(
  $$ SELECT * FROM identity.session_profile(sha256('organizer')) $$,
  'a disabled user has no profile'
);

SELECT * FROM finish();
ROLLBACK;
