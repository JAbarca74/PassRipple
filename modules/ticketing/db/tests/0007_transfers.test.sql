BEGIN;
SELECT plan(37);

-- ── Superuser setup ──────────────────────────────────────────────────────────
INSERT INTO identity.organizations (id, name, verified_at) VALUES
  ('00000000-0000-4000-8000-00000000000a', 'Org 1', now());
INSERT INTO jurisdictions.jurisdictions (canton_code, name, tax_rate_bps, courtesy_deduct_bps, settlement_rule) VALUES
  ('TEST-01', 'Test', 0, '{}', 'next_business_day');

-- Future event (Event 1) and started event (Event 2)
INSERT INTO events.events (id, org_id, canton_code, name, venue_name, starts_at, age_rating, permitted_capacity, status, published_at) VALUES
  ('00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-00000000000a', 'TEST-01', 'Future Event', 'Arena', now() + interval '1 day', 'all', 10, 'on_sale', now()),
  ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-00000000000a', 'TEST-01', 'Started Event', 'Club', now() - interval '1 hour', 'all', 10, 'closed', now() - interval '2 days');

INSERT INTO catalog.ticket_types (id, event_id, name, price_crc, audience, entry_mode) VALUES
  ('00000000-0000-4000-8000-000000000020', '00000000-0000-4000-8000-000000000010', 'General Future', 1000, 'public', 'single_use'),
  ('00000000-0000-4000-8000-000000000021', '00000000-0000-4000-8000-000000000011', 'General Started', 1000, 'public', 'single_use');

INSERT INTO inventory.event_capacity (event_id, permitted_capacity, committed) VALUES
  ('00000000-0000-4000-8000-000000000010', 10, 0),
  ('00000000-0000-4000-8000-000000000011', 10, 0);

-- Insert tickets unbound
INSERT INTO ticketing.tickets (id, event_id, ticket_type_id, origin, code_human) VALUES
  ('00000000-0000-4000-8000-000000000040', '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000020', 'courtesy', 'C0DE400000'),
  ('00000000-0000-4000-8000-000000000041', '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000020', 'courtesy', 'C0DE410000'),
  ('00000000-0000-4000-8000-000000000042', '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000020', 'courtesy', 'C0DE420000'),
  ('00000000-0000-4000-8000-000000000043', '00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000021', 'courtesy', 'C0DE430000'),
  ('00000000-0000-4000-8000-000000000044', '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000020', 'courtesy', 'C0DE440000');

-- Bind tickets as system
SELECT set_config('app.actor_role', 'system', true);

-- Ticket 40: bound to key 1
SELECT ticketing.bind('00000000-0000-4000-8000-000000000040', decode('1111111111111111111111111111111111111111111111111111111111111111', 'hex'), 'bind');

-- Ticket 41 remains issued (unbound)

-- Ticket 42: bound to version 6
SELECT ticketing.bind('00000000-0000-4000-8000-000000000042', decode('1111111111111111111111111111111111111111111111111111111111111111', 'hex'), 'bind');
SELECT ticketing.bind('00000000-0000-4000-8000-000000000042', decode('2222222222222222222222222222222222222222222222222222222222222222', 'hex'), 'transfer');
SELECT ticketing.bind('00000000-0000-4000-8000-000000000042', decode('3333333333333333333333333333333333333333333333333333333333333333', 'hex'), 'recovery');
SELECT ticketing.bind('00000000-0000-4000-8000-000000000042', decode('4444444444444444444444444444444444444444444444444444444444444444', 'hex'), 'transfer');
SELECT ticketing.bind('00000000-0000-4000-8000-000000000042', decode('5555555555555555555555555555555555555555555555555555555555555555', 'hex'), 'recovery');
SELECT ticketing.bind('00000000-0000-4000-8000-000000000042', decode('6666666666666666666666666666666666666666666666666666666666666666', 'hex'), 'transfer');

-- Ticket 43 on started event: bound to key 1
SELECT ticketing.bind('00000000-0000-4000-8000-000000000043', decode('1111111111111111111111111111111111111111111111111111111111111111', 'hex'), 'bind');

-- Ticket 44: bound to key 1 (for cancel / rebind tests)
SELECT ticketing.bind('00000000-0000-4000-8000-000000000044', decode('1111111111111111111111111111111111111111111111111111111111111111', 'hex'), 'bind');

-- ── 1. offer_transfer ────────────────────────────────────────────────────────
-- Non-system actor throws 42501
SELECT set_config('app.actor_role', 'buyer', true);
SELECT throws_ok(
  $$ SELECT ticketing.offer_transfer('00000000-0000-4000-8000-000000000040', decode('1111111111111111111111111111111111111111111111111111111111111111', 'hex'), 'prx_12345678901234567890123456789012', interval '1 hour') $$,
  '42501', NULL, 'buyer cannot offer transfer'
);

SELECT set_config('app.actor_role', 'system', true);

-- Token < 32 chars throws 22023
SELECT throws_ok(
  $$ SELECT ticketing.offer_transfer('00000000-0000-4000-8000-000000000040', decode('1111111111111111111111111111111111111111111111111111111111111111', 'hex'), 'prx_short', interval '1 hour') $$,
  '22023', NULL, 'offer token < 32 chars throws 22023'
);

-- ttl <= 0 or > 7 days throws 22023
SELECT throws_ok(
  $$ SELECT ticketing.offer_transfer('00000000-0000-4000-8000-000000000040', decode('1111111111111111111111111111111111111111111111111111111111111111', 'hex'), 'prx_12345678901234567890123456789012', interval '0 seconds') $$,
  '22023', NULL, 'ttl <= 0 throws 22023'
);
SELECT throws_ok(
  $$ SELECT ticketing.offer_transfer('00000000-0000-4000-8000-000000000040', decode('1111111111111111111111111111111111111111111111111111111111111111', 'hex'), 'prx_12345678901234567890123456789012', interval '8 days') $$,
  '22023', NULL, 'ttl > 7 days throws 22023'
);

-- Nonexistent ticket throws P0002
SELECT throws_ok(
  $$ SELECT ticketing.offer_transfer('00000000-0000-4000-8000-000000000099', decode('1111111111111111111111111111111111111111111111111111111111111111', 'hex'), 'prx_12345678901234567890123456789012', interval '1 hour') $$,
  'P0002', NULL, 'nonexistent ticket throws P0002'
);

-- Unbound ticket throws 42501
SELECT throws_ok(
  $$ SELECT ticketing.offer_transfer('00000000-0000-4000-8000-000000000041', decode('1111111111111111111111111111111111111111111111111111111111111111', 'hex'), 'prx_12345678901234567890123456789012', interval '1 hour') $$,
  '42501', NULL, 'unbound ticket throws 42501'
);

-- Wrong holder key throws 42501
SELECT throws_ok(
  $$ SELECT ticketing.offer_transfer('00000000-0000-4000-8000-000000000040', decode('2222222222222222222222222222222222222222222222222222222222222222', 'hex'), 'prx_12345678901234567890123456789012', interval '1 hour') $$,
  '42501', NULL, 'key not holding ticket throws 42501'
);

-- Key version >= 6 throws 23514
SELECT throws_ok(
  $$ SELECT ticketing.offer_transfer('00000000-0000-4000-8000-000000000042', decode('6666666666666666666666666666666666666666666666666666666666666666', 'hex'), 'prx_12345678901234567890123456789012', interval '1 hour') $$,
  '23514', NULL, 'key_version 6 throws 23514'
);

-- Event already started throws 55000
SELECT throws_ok(
  $$ SELECT ticketing.offer_transfer('00000000-0000-4000-8000-000000000043', decode('1111111111111111111111111111111111111111111111111111111111111111', 'hex'), 'prx_12345678901234567890123456789012', interval '1 hour') $$,
  '55000', NULL, 'started event throws 55000'
);

-- expires_at = least(now() + ttl, starts_at)
-- TTL longer than event starts_at (starts in 1 day; ttl 3 days) caps at starts_at
SELECT is(
  (SELECT ticketing.offer_transfer('00000000-0000-4000-8000-000000000040', decode('1111111111111111111111111111111111111111111111111111111111111111', 'hex'), 'prx_offer_token_1_0000000000000001', interval '3 days')),
  (SELECT starts_at FROM events.events WHERE id = '00000000-0000-4000-8000-000000000010'),
  'offer expiry caps at starts_at when ttl is longer'
);

-- Second offer cancels first offer and leaves only one open
SELECT is(
  (SELECT count(*) FROM ticketing.transfers WHERE ticket_id = '00000000-0000-4000-8000-000000000040' AND cancelled_at IS NULL AND claimed_at IS NULL),
  1::bigint,
  'one open offer after first offer'
);

SELECT ok(
  (SELECT ticketing.offer_transfer('00000000-0000-4000-8000-000000000040', decode('1111111111111111111111111111111111111111111111111111111111111111', 'hex'), 'prx_offer_token_2_0000000000000002', interval '2 hours') IS NOT NULL),
  'second offer succeeded'
);

SELECT is(
  (SELECT count(*) FROM ticketing.transfers WHERE ticket_id = '00000000-0000-4000-8000-000000000040' AND cancelled_at IS NULL AND claimed_at IS NULL),
  1::bigint,
  'still exactly one open offer after second offer'
);

SELECT ok(
  (SELECT cancelled_at IS NOT NULL FROM ticketing.transfers WHERE offer_hash = sha256(convert_to('prx_offer_token_1_0000000000000001', 'UTF8'))),
  'first offer was marked cancelled_at'
);

-- ── 2. transfer_offer states ─────────────────────────────────────────────────
-- Unknown link returns 0 rows
SELECT is(
  (SELECT count(*) FROM ticketing.transfer_offer('prx_unknown_offer_0000000000000099')),
  0::bigint,
  'unknown offer token returns 0 rows'
);

-- Open state on offer 2
SELECT is(
  (SELECT state FROM ticketing.transfer_offer('prx_offer_token_2_0000000000000002')),
  'open',
  'second offer state is open'
);

-- Cancelled state on superseded offer 1
SELECT is(
  (SELECT state FROM ticketing.transfer_offer('prx_offer_token_1_0000000000000001')),
  'cancelled',
  'superseded offer state is cancelled'
);

-- Cancelled state when ticket key version changes due to recovery
-- Offer on ticket 44
SELECT ticketing.offer_transfer('00000000-0000-4000-8000-000000000044', decode('1111111111111111111111111111111111111111111111111111111111111111', 'hex'), 'prx_offer_token_44_000000000000001', interval '2 hours');
SELECT is((SELECT state FROM ticketing.transfer_offer('prx_offer_token_44_000000000000001')), 'open', 'offer 44 is open');
-- Rebind ticket 44 to version 2 via recovery
SELECT ticketing.bind('00000000-0000-4000-8000-000000000044', decode('7777777777777777777777777777777777777777777777777777777777777777', 'hex'), 'recovery');
SELECT is((SELECT state FROM ticketing.transfer_offer('prx_offer_token_44_000000000000001')), 'cancelled', 'offer becomes cancelled when key_version changes');

-- Expired state
-- Create an offer and update its timestamps so that expires_at <= now() while maintaining expires_at > created_at
SELECT ticketing.offer_transfer('00000000-0000-4000-8000-000000000044', decode('7777777777777777777777777777777777777777777777777777777777777777', 'hex'), 'prx_offer_expired_0000000000000001', interval '1 hour');
UPDATE ticketing.transfers
   SET created_at = now() - interval '2 hours',
       expires_at = now() - interval '1 hour'
 WHERE offer_hash = sha256(convert_to('prx_offer_expired_0000000000000001', 'UTF8'));
SELECT is((SELECT state FROM ticketing.transfer_offer('prx_offer_expired_0000000000000001')), 'expired', 'state is expired when past expires_at');

-- ── 3. claim_transfer ────────────────────────────────────────────────────────
-- Unknown offer throws P0002
SELECT throws_ok(
  $$ SELECT ticketing.claim_transfer('prx_unknown_00000000000000000000099', decode('2222222222222222222222222222222222222222222222222222222222222222', 'hex'), 'prh_receiver_00000000000000000001') $$,
  'P0002', NULL, 'unknown offer throws P0002'
);

-- Holder token < 32 chars throws 22023
SELECT throws_ok(
  $$ SELECT ticketing.claim_transfer('prx_offer_token_2_0000000000000002', decode('2222222222222222222222222222222222222222222222222222222222222222', 'hex'), 'prh_short') $$,
  '22023', NULL, 'receiver token < 32 chars throws 22023'
);

-- Same key as owner throws 23514
SELECT throws_ok(
  $$ SELECT ticketing.claim_transfer('prx_offer_token_2_0000000000000002', decode('1111111111111111111111111111111111111111111111111111111111111111', 'hex'), 'prh_receiver_00000000000000000001') $$,
  '23514', NULL, 'claiming with same key as owner throws 23514'
);

-- Claim on cancelled offer throws 55000
SELECT throws_ok(
  $$ SELECT ticketing.claim_transfer('prx_offer_token_1_0000000000000001', decode('2222222222222222222222222222222222222222222222222222222222222222', 'hex'), 'prh_receiver_00000000000000000001') $$,
  '55000', NULL, 'claim on cancelled offer throws 55000'
);

-- Claim on expired offer throws 55000
SELECT throws_ok(
  $$ SELECT ticketing.claim_transfer('prx_offer_expired_0000000000000001', decode('2222222222222222222222222222222222222222222222222222222222222222', 'hex'), 'prh_receiver_00000000000000000001') $$,
  '55000', NULL, 'claim on expired offer throws 55000'
);

-- Valid claim on offer 2: returns new key version (2)
SELECT is(
  (SELECT ticketing.claim_transfer('prx_offer_token_2_0000000000000002', decode('2222222222222222222222222222222222222222222222222222222222222222', 'hex'), 'prh_receiver_00000000000000000001')),
  2::smallint,
  'claiming transfer returns key_version 2'
);

-- State is now claimed
SELECT is(
  (SELECT state FROM ticketing.transfer_offer('prx_offer_token_2_0000000000000002')),
  'claimed',
  'claimed offer state is claimed'
);

-- holder_hash is saved
SELECT is(
  (SELECT holder_hash FROM ticketing.transfers WHERE offer_hash = sha256(convert_to('prx_offer_token_2_0000000000000002', 'UTF8'))),
  sha256(convert_to('prh_receiver_00000000000000000001', 'UTF8')),
  'holder_hash matches sha256 of receiver token'
);

-- ticket.transferred event emitted in ticketing.outbox
SELECT ok(
  (SELECT EXISTS (
    SELECT 1 FROM ticketing.outbox
     WHERE type = 'ticket.transferred'
       AND (payload->>'ticketId')::uuid = '00000000-0000-4000-8000-000000000040'
       AND (payload->>'keyVersion')::int = 2
  )),
  'ticket.transferred event emitted in outbox'
);

-- Second claim throws 55000
SELECT throws_ok(
  $$ SELECT ticketing.claim_transfer('prx_offer_token_2_0000000000000002', decode('3333333333333333333333333333333333333333333333333333333333333333', 'hex'), 'prh_receiver_00000000000000000002') $$,
  '55000', NULL, 'second claim on same offer throws 55000'
);

-- ── 4. cancel_transfer ───────────────────────────────────────────────────────
-- Offer a new transfer for ticket 44
SELECT ticketing.offer_transfer('00000000-0000-4000-8000-000000000044', decode('7777777777777777777777777777777777777777777777777777777777777777', 'hex'), 'prx_offer_cancel_0000000000000001', interval '1 hour');

-- Wrong key throws 42501
SELECT throws_ok(
  $$ SELECT ticketing.cancel_transfer('00000000-0000-4000-8000-000000000044', decode('1111111111111111111111111111111111111111111111111111111111111111', 'hex')) $$,
  '42501', NULL, 'cancel with wrong key throws 42501'
);

-- First cancel returns true
SELECT is(
  (SELECT ticketing.cancel_transfer('00000000-0000-4000-8000-000000000044', decode('7777777777777777777777777777777777777777777777777777777777777777', 'hex'))),
  true,
  'cancel_transfer returns true when open offer was cancelled'
);

-- Second cancel returns false
SELECT is(
  (SELECT ticketing.cancel_transfer('00000000-0000-4000-8000-000000000044', decode('7777777777777777777777777777777777777777777777777777777777777777', 'hex'))),
  false,
  'second cancel_transfer returns false'
);

-- ── 5. held_ticket and transferred_tickets ───────────────────────────────────
-- held_ticket with valid receiver token returns row
SELECT is(
  (SELECT ticket_id FROM ticketing.held_ticket('prh_receiver_00000000000000000001')),
  '00000000-0000-4000-8000-000000000040'::uuid,
  'held_ticket returns ticket for receiver token'
);

-- held_ticket with other token returns nothing
SELECT is(
  (SELECT count(*) FROM ticketing.held_ticket('prh_other_receiver_0000000000000002')),
  0::bigint,
  'held_ticket with unknown token returns 0 rows'
);

-- transferred_tickets returns only ticket 40 (transferred) and not ticket 44 (recovered)
SELECT is(
  (SELECT ARRAY(
    SELECT t.id FROM ticketing.transferred_tickets(ARRAY[
      '00000000-0000-4000-8000-000000000040'::uuid,
      '00000000-0000-4000-8000-000000000044'::uuid
    ]) t(id) ORDER BY 1
  )),
  ARRAY['00000000-0000-4000-8000-000000000040'::uuid],
  'transferred_tickets lists only tickets with reason transfer'
);

SELECT * FROM finish();
ROLLBACK;
