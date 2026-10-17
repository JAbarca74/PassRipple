BEGIN;
SELECT plan(15);

-- ── Superuser setup ──────────────────────────────────────────────────────────
INSERT INTO identity.users (id, is_admin) VALUES
  ('00000000-0000-4000-8000-00000000000a', true),
  ('00000000-0000-4000-8000-00000000000b', false);

INSERT INTO privacy.legal_documents (id, kind, version, content_sha256) VALUES
  ('00000000-0000-4000-8000-000000000010', 'terms', 'v1', sha256('termsv1'));

INSERT INTO privacy.consents (id, subject_id, purpose, granted, document_version, source) VALUES
  ('00000000-0000-4000-8000-000000000020', '00000000-0000-4000-8000-00000000000a', 'terms', true, 'v1', 'onboarding');

-- ── API actions ──────────────────────────────────────────────────────────────
SET LOCAL SESSION AUTHORIZATION passripple_api;

SELECT identity.set_actor('00000000-0000-4000-8000-00000000000b', 'staff');

SELECT throws_ok(
  $$ SELECT privacy.record_consent('00000000-0000-4000-8000-00000000000a', 'terms', true, 'v1', 'checkout') $$,
  '42501', NULL, 'cannot record consent for another person'
);

SELECT throws_ok(
  $$ UPDATE privacy.consents SET granted = false WHERE id = '00000000-0000-4000-8000-000000000020' $$,
  '42501', NULL, 'API cannot UPDATE consents'
);
SELECT throws_ok(
  $$ DELETE FROM privacy.consents WHERE id = '00000000-0000-4000-8000-000000000020' $$,
  '42501', NULL, 'API cannot DELETE consents'
);
SELECT throws_ok(
  $$ UPDATE privacy.legal_documents SET version = 'v2' WHERE id = '00000000-0000-4000-8000-000000000010' $$,
  '42501', NULL, 'API cannot UPDATE legal_documents'
);

SELECT identity.set_actor(NULL, 'buyer');
SELECT lives_ok(
  $$ SELECT privacy.record_consent('00000000-0000-4000-8000-00000000000c', 'terms', true, 'v1', 'checkout') $$,
  'buyer records consent with anonymous id'
);

-- Superuser checks
RESET SESSION AUTHORIZATION;
SET LOCAL ROLE passripple_owner_privacy;

SELECT throws_ok(
  $$ UPDATE privacy.consents SET granted = false WHERE id = '00000000-0000-4000-8000-000000000020' $$,
  '23001', NULL, 'owner cannot UPDATE consents'
);
SELECT throws_ok(
  $$ DELETE FROM privacy.consents WHERE id = '00000000-0000-4000-8000-000000000020' $$,
  '23001', NULL, 'owner cannot DELETE consents'
);
SELECT throws_ok(
  $$ TRUNCATE privacy.consents $$,
  '23001', NULL, 'owner cannot TRUNCATE consents'
);

SELECT throws_ok(
  $$ UPDATE privacy.legal_documents SET version = 'v2' WHERE id = '00000000-0000-4000-8000-000000000010' $$,
  '23001', NULL, 'owner cannot UPDATE legal_documents'
);
SELECT throws_ok(
  $$ DELETE FROM privacy.legal_documents WHERE id = '00000000-0000-4000-8000-000000000010' $$,
  '23001', NULL, 'owner cannot DELETE legal_documents'
);
SELECT throws_ok(
  $$ TRUNCATE privacy.legal_documents $$,
  '23001', NULL, 'owner cannot TRUNCATE legal_documents'
);

RESET ROLE;

SELECT * FROM finish(true);
ROLLBACK;
