BEGIN;
SELECT plan(34);

-- ── Superuser setup ──────────────────────────────────────────────────────────
INSERT INTO identity.organizations (id, name, verified_at) VALUES
  ('00000000-0000-4000-8000-00000000000a', 'Org 1', now());
INSERT INTO jurisdictions.jurisdictions (canton_code, name, tax_rate_bps, courtesy_deduct_bps, settlement_rule) VALUES
  ('TEST-01', 'Test', 0, '{}', 'next_business_day');

INSERT INTO events.events (id, org_id, canton_code, name, venue_name, starts_at, age_rating, permitted_capacity, status, published_at) VALUES
  ('00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-00000000000a', 'TEST-01', 'Future Event', 'Arena', now() + interval '1 day', 'all', 10, 'on_sale', now());

INSERT INTO catalog.ticket_types (id, event_id, name, price_crc, audience, entry_mode) VALUES
  ('00000000-0000-4000-8000-000000000020', '00000000-0000-4000-8000-000000000010', 'General Future', 1000, 'public', 'single_use');

INSERT INTO inventory.event_capacity (event_id, permitted_capacity, committed) VALUES
  ('00000000-0000-4000-8000-000000000010', 10, 0);

INSERT INTO ticketing.tickets (id, event_id, ticket_type_id, origin, code_human) VALUES
  ('00000000-0000-4000-8000-000000000040', '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000020', 'courtesy', 'C0DE400000'),
  ('00000000-0000-4000-8000-000000000041', '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000020', 'courtesy', 'C0DE410000'),
  ('00000000-0000-4000-8000-000000000042', '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000020', 'courtesy', 'C0DE420000'),
  ('00000000-0000-4000-8000-000000000043', '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000020', 'courtesy', 'C0DE430000');

SELECT set_config('app.actor_role', 'system', true);

-- Bind tickets to key 1
SELECT ticketing.bind('00000000-0000-4000-8000-000000000040', decode('1111111111111111111111111111111111111111111111111111111111111111', 'hex'), 'bind');
SELECT ticketing.bind('00000000-0000-4000-8000-000000000041', decode('1111111111111111111111111111111111111111111111111111111111111111', 'hex'), 'bind');
SELECT ticketing.bind('00000000-0000-4000-8000-000000000042', decode('1111111111111111111111111111111111111111111111111111111111111111', 'hex'), 'bind');
SELECT ticketing.bind('00000000-0000-4000-8000-000000000043', decode('1111111111111111111111111111111111111111111111111111111111111111', 'hex'), 'bind');

-- Offer transfers on all four tickets
SELECT ticketing.offer_transfer('00000000-0000-4000-8000-000000000040', decode('1111111111111111111111111111111111111111111111111111111111111111', 'hex'), 'prx_offer_40_00000000000000000001', interval '1 hour');
SELECT ticketing.offer_transfer('00000000-0000-4000-8000-000000000041', decode('1111111111111111111111111111111111111111111111111111111111111111', 'hex'), 'prx_offer_41_00000000000000000001', interval '1 hour');
SELECT ticketing.offer_transfer('00000000-0000-4000-8000-000000000042', decode('1111111111111111111111111111111111111111111111111111111111111111', 'hex'), 'prx_offer_42_first_00000000000001', interval '1 hour');
SELECT ticketing.offer_transfer('00000000-0000-4000-8000-000000000043', decode('1111111111111111111111111111111111111111111111111111111111111111', 'hex'), 'prx_offer_43_00000000000000000001', interval '1 hour');

-- ── 1. claim_transfer with and without email ─────────────────────────────────
-- Claim with email stores holder_email
SELECT is(
  (SELECT ticketing.claim_transfer('prx_offer_40_00000000000000000001', decode('2222222222222222222222222222222222222222222222222222222222222222', 'hex'), 'prh_holder_40_initial_00000000001', 'receiver@example.com')),
  2::smallint,
  'claim_transfer with email returns key_version 2'
);

SELECT is(
  (SELECT holder_email FROM ticketing.transfers WHERE offer_hash = sha256(convert_to('prx_offer_40_00000000000000000001', 'UTF8'))),
  'receiver@example.com',
  'claim_transfer with email stores holder_email'
);

-- Claim without email (3-arg call) leaves holder_email null
SELECT is(
  (SELECT ticketing.claim_transfer('prx_offer_41_00000000000000000001', decode('2222222222222222222222222222222222222222222222222222222222222222', 'hex'), 'prh_holder_41_no_email_0000000001')),
  2::smallint,
  '3-arg claim_transfer without email returns key_version 2'
);

SELECT is(
  (SELECT holder_email FROM ticketing.transfers WHERE offer_hash = sha256(convert_to('prx_offer_41_00000000000000000001', 'UTF8'))),
  NULL,
  '3-arg claim_transfer leaves holder_email NULL'
);

-- Invalid email format is rejected by the CHECK constraint
SELECT throws_ok(
  $$ SELECT ticketing.claim_transfer('prx_offer_43_00000000000000000001', decode('2222222222222222222222222222222222222222222222222222222222222222', 'hex'), 'prh_holder_43_bad_email_000000001', 'not-an-email') $$,
  '23514', NULL, 'invalid email without @ rejected by CHECK'
);

SELECT throws_ok(
  $$ SELECT ticketing.claim_transfer('prx_offer_43_00000000000000000001', decode('2222222222222222222222222222222222222222222222222222222222222222', 'hex'), 'prh_holder_43_bad_email_000000001', 'bad space@example.com') $$,
  '23514', NULL, 'invalid email with whitespace rejected by CHECK'
);

-- ── 2. is_current_claim ──────────────────────────────────────────────────────
-- False for an unclaimed offer
SELECT is(
  (SELECT ticketing.is_current_claim(id) FROM ticketing.transfers WHERE offer_hash = sha256(convert_to('prx_offer_43_00000000000000000001', 'UTF8'))),
  false,
  'is_current_claim is false for unclaimed offer'
);

-- True for latest claim on ticket 40
SELECT is(
  (SELECT ticketing.is_current_claim(id) FROM ticketing.transfers WHERE offer_hash = sha256(convert_to('prx_offer_40_00000000000000000001', 'UTF8'))),
  true,
  'is_current_claim is true for latest claim'
);

-- Claim ticket 42 first with first@example.com, then transfer again to receiver@example.com
SELECT ticketing.claim_transfer('prx_offer_42_first_00000000000001', decode('2222222222222222222222222222222222222222222222222222222222222222', 'hex'), 'prh_holder_42_first_0000000000001', 'first@example.com');
UPDATE ticketing.transfers
   SET created_at = now() - interval '10 minutes',
       claimed_at = now() - interval '5 minutes'
 WHERE offer_hash = sha256(convert_to('prx_offer_42_first_00000000000001', 'UTF8'));

SELECT ticketing.offer_transfer('00000000-0000-4000-8000-000000000042', decode('2222222222222222222222222222222222222222222222222222222222222222', 'hex'), 'prx_offer_42_second_0000000000002', interval '1 hour');
SELECT ticketing.claim_transfer('prx_offer_42_second_0000000000002', decode('3333333333333333333333333333333333333333333333333333333333333333', 'hex'), 'prh_holder_42_second_000000000002', 'receiver@example.com');

SELECT is(
  (SELECT ticketing.is_current_claim(id) FROM ticketing.transfers WHERE offer_hash = sha256(convert_to('prx_offer_42_first_00000000000001', 'UTF8'))),
  false,
  'is_current_claim becomes false after ticket is transferred again'
);

SELECT is(
  (SELECT ticketing.is_current_claim(id) FROM ticketing.transfers WHERE offer_hash = sha256(convert_to('prx_offer_42_second_0000000000002', 'UTF8'))),
  true,
  'is_current_claim is true for the new receiver claim'
);

-- ── 3. recover_held ──────────────────────────────────────────────────────────
-- Non-system actor rejected
SELECT set_config('app.actor_role', 'buyer', true);
SELECT throws_ok(
  $$ SELECT ticketing.recover_held((SELECT id FROM ticketing.transfers WHERE offer_hash = sha256(convert_to('prx_offer_40_00000000000000000001', 'UTF8'))), 'prh_recovered_40_0000000000000001') $$,
  '42501', NULL, 'non-system actor cannot call recover_held'
);

SELECT set_config('app.actor_role', 'system', true);

-- Token shorter than 32 rejected
SELECT throws_ok(
  $$ SELECT ticketing.recover_held((SELECT id FROM ticketing.transfers WHERE offer_hash = sha256(convert_to('prx_offer_40_00000000000000000001', 'UTF8'))), 'prh_short') $$,
  '22023', NULL, 'recover_held rejects token shorter than 32 chars'
);

-- Rejected when holder_email is null
SELECT throws_ok(
  $$ SELECT ticketing.recover_held((SELECT id FROM ticketing.transfers WHERE offer_hash = sha256(convert_to('prx_offer_41_00000000000000000001', 'UTF8'))), 'prh_recovered_41_0000000000000001') $$,
  '42501', NULL, 'recover_held rejects claim where holder_email is null'
);

-- Rejected when the claim is no longer current
SELECT throws_ok(
  $$ SELECT ticketing.recover_held((SELECT id FROM ticketing.transfers WHERE offer_hash = sha256(convert_to('prx_offer_42_first_00000000000001', 'UTF8'))), 'prh_recovered_42_0000000000000001') $$,
  '42501', NULL, 'recover_held rejects claim that is no longer current'
);

-- Works for current claim with email
SELECT lives_ok(
  $$ SELECT ticketing.recover_held((SELECT id FROM ticketing.transfers WHERE offer_hash = sha256(convert_to('prx_offer_40_00000000000000000001', 'UTF8'))), 'prh_recovered_40_0000000000000001') $$,
  'recover_held succeeds for current claim with holder_email'
);

SELECT is(
  (SELECT holder_hash FROM ticketing.transfers WHERE offer_hash = sha256(convert_to('prx_offer_40_00000000000000000001', 'UTF8'))),
  sha256(convert_to('prh_recovered_40_0000000000000001', 'UTF8')),
  'recover_held replaces holder_hash with new token hash'
);

SELECT ok(
  (SELECT rebind_until > now() + interval '59 minutes' AND rebind_until <= now() + interval '1 hour'
     FROM ticketing.transfers
    WHERE offer_hash = sha256(convert_to('prx_offer_40_00000000000000000001', 'UTF8'))),
  'recover_held sets rebind_until to about 1 hour ahead'
);

SELECT is(
  (SELECT count(*) FROM ticketing.held_ticket('prh_holder_40_initial_00000000001')),
  0::bigint,
  'old holder token no longer finds the ticket via held_ticket'
);

SELECT is(
  (SELECT ticket_id FROM ticketing.held_ticket('prh_recovered_40_0000000000000001')),
  '00000000-0000-4000-8000-000000000040'::uuid,
  'new holder token finds the ticket via held_ticket'
);

-- ── 4. rebind_held ───────────────────────────────────────────────────────────
-- Non-system actor rejected
SELECT set_config('app.actor_role', 'buyer', true);
SELECT throws_ok(
  $$ SELECT ticketing.rebind_held('prh_recovered_40_0000000000000001', decode('4444444444444444444444444444444444444444444444444444444444444444', 'hex')) $$,
  '42501', NULL, 'non-system actor cannot call rebind_held'
);

SELECT set_config('app.actor_role', 'system', true);

-- Unknown token rejected
SELECT throws_ok(
  $$ SELECT ticketing.rebind_held('prh_unknown_token_000000000000099', decode('4444444444444444444444444444444444444444444444444444444444444444', 'hex')) $$,
  '42501', NULL, 'rebind_held rejects unknown holder token'
);

-- Same device key returns current key_version without a new binding
SELECT is(
  (SELECT ticketing.rebind_held('prh_recovered_40_0000000000000001', decode('2222222222222222222222222222222222222222222222222222222222222222', 'hex'))),
  2::smallint,
  'rebind_held with same device key returns current key_version 2'
);

SELECT is(
  (SELECT count(*) FROM ticketing.ticket_bindings WHERE ticket_id = '00000000-0000-4000-8000-000000000040'),
  2::bigint,
  'rebind_held with same device key does not create a new binding'
);

SELECT ok(
  (SELECT rebind_until IS NOT NULL FROM ticketing.transfers WHERE offer_hash = sha256(convert_to('prx_offer_40_00000000000000000001', 'UTF8'))),
  'rebind_held with same device key preserves rebind_until'
);

-- New key within rebind_until binds with reason recovery, increments key_version and clears rebind_until
SELECT is(
  (SELECT ticketing.rebind_held('prh_recovered_40_0000000000000001', decode('4444444444444444444444444444444444444444444444444444444444444444', 'hex'))),
  3::smallint,
  'rebind_held with new key increments key_version to 3'
);

SELECT is(
  (SELECT reason FROM ticketing.ticket_bindings WHERE ticket_id = '00000000-0000-4000-8000-000000000040' AND key_version = 3),
  'recovery',
  'rebind_held records binding with reason recovery'
);

SELECT is(
  (SELECT rebind_until FROM ticketing.transfers WHERE offer_hash = sha256(convert_to('prx_offer_40_00000000000000000001', 'UTF8'))),
  NULL,
  'rebind_held clears rebind_until after rebinding'
);

-- Calling again from the same new device returns current key_version 3
SELECT is(
  (SELECT ticketing.rebind_held('prh_recovered_40_0000000000000001', decode('4444444444444444444444444444444444444444444444444444444444444444', 'hex'))),
  3::smallint,
  'rebind_held called again with same new key returns key_version 3'
);

-- A second different key afterwards is rejected (object_not_in_prerequisite_state / 55000)
SELECT throws_ok(
  $$ SELECT ticketing.rebind_held('prh_recovered_40_0000000000000001', decode('5555555555555555555555555555555555555555555555555555555555555555', 'hex')) $$,
  '55000', NULL, 'second different key after rebind is rejected with 55000'
);

-- Expired rebind_until rejected
SELECT ticketing.recover_held(
  (SELECT id FROM ticketing.transfers WHERE offer_hash = sha256(convert_to('prx_offer_42_second_0000000000002', 'UTF8'))),
  'prh_recovered_42_second_000000002'
);
UPDATE ticketing.transfers
   SET rebind_until = now() - interval '1 minute'
 WHERE offer_hash = sha256(convert_to('prx_offer_42_second_0000000000002', 'UTF8'));

SELECT throws_ok(
  $$ SELECT ticketing.rebind_held('prh_recovered_42_second_000000002', decode('6666666666666666666666666666666666666666666666666666666666666666', 'hex')) $$,
  '55000', NULL, 'rebind_held rejects expired rebind_until with 55000'
);

-- ── 5. forget_holder_email ───────────────────────────────────────────────────
-- Non-system actor rejected
SELECT set_config('app.actor_role', 'buyer', true);
SELECT throws_ok(
  $$ SELECT ticketing.forget_holder_email('receiver@example.com') $$,
  '42501', NULL, 'non-system actor cannot call forget_holder_email'
);

SELECT set_config('app.actor_role', 'system', true);

-- Set a non-null rebind_until on one of the receiver@example.com claims to verify it is cleared
UPDATE ticketing.transfers
   SET rebind_until = now() + interval '30 minutes'
 WHERE offer_hash = sha256(convert_to('prx_offer_42_second_0000000000002', 'UTF8'));

SELECT is(
  (SELECT ticketing.forget_holder_email('receiver@example.com')),
  2,
  'forget_holder_email returns the count of matching claims (2)'
);

SELECT is(
  (SELECT count(*) FROM ticketing.transfers WHERE holder_email = 'receiver@example.com' OR rebind_until IS NOT NULL),
  0::bigint,
  'forget_holder_email clears holder_email and rebind_until on all matching claims'
);

SELECT is(
  (SELECT ticketing.forget_holder_email('receiver@example.com')),
  0,
  'forget_holder_email returns 0 when no claims match'
);

SELECT * FROM finish();
ROLLBACK;
