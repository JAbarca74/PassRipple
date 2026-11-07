BEGIN;
SELECT plan(32);

-- ── Superuser setup ──────────────────────────────────────────────────────────
INSERT INTO identity.organizations (id, name, verified_at) VALUES
  ('00000000-0000-4000-8000-00000000000a', 'Org 1', now());
INSERT INTO jurisdictions.jurisdictions (canton_code, name, tax_rate_bps, courtesy_deduct_bps, settlement_rule) VALUES
  ('TEST-01', 'Test', 0, '{}', 'next_business_day');
INSERT INTO events.events (id, org_id, canton_code, name, venue_name, starts_at, age_rating, permitted_capacity, status, published_at) VALUES
  ('00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-00000000000a', 'TEST-01', 'Event 1', 'Venue', now() + interval '1 day', 'all', 10, 'on_sale', now());

INSERT INTO catalog.ticket_types (id, event_id, name, price_crc, audience, entry_mode) VALUES
  ('00000000-0000-4000-8000-000000000020', '00000000-0000-4000-8000-000000000010', 'Free Ticket', 0, 'public', 'single_use'),
  ('00000000-0000-4000-8000-000000000021', '00000000-0000-4000-8000-000000000010', 'Paid Ticket', 1000, 'public', 'single_use');

INSERT INTO inventory.event_capacity (event_id, permitted_capacity, committed) VALUES
  ('00000000-0000-4000-8000-000000000010', 10, 0);

-- One issued ticket for successful transitions and one void ticket for error cases
INSERT INTO ticketing.tickets (id, event_id, ticket_type_id, origin, code_human) VALUES
  ('00000000-0000-4000-8000-000000000040', '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000021', 'courtesy', 'C0DE400000'),
  ('00000000-0000-4000-8000-000000000041', '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000021', 'courtesy', 'C0DE410000');

UPDATE ticketing.tickets SET status = 'issued' WHERE id = '00000000-0000-4000-8000-000000000040';
UPDATE ticketing.tickets SET status = 'void' WHERE id = '00000000-0000-4000-8000-000000000041';

-- ── Privilege check: non-system actor cannot bind ────────────────────────────
SELECT set_config('app.actor_role', 'buyer', true);

SELECT throws_ok(
  $$ SELECT ticketing.bind('00000000-0000-4000-8000-000000000040', decode('1111111111111111111111111111111111111111111111111111111111111111', 'hex'), 'bind') $$,
  '42501', NULL, 'buyer cannot bind ticket'
);

SELECT is(
  (SELECT count(*) FROM ticketing.outbox WHERE (payload->>'ticketId')::uuid = '00000000-0000-4000-8000-000000000040'::uuid),
  0::bigint,
  'no outbox row on privilege failure'
);

-- ── System actor binding tests ───────────────────────────────────────────────
SELECT set_config('app.actor_role', 'system', true);

-- 1. Initial bind -> ticket.bound with reason 'bind', keyVersion 1
SELECT is(
  (SELECT ticketing.bind('00000000-0000-4000-8000-000000000040', decode('1111111111111111111111111111111111111111111111111111111111111111', 'hex'), 'bind')),
  1::smallint,
  'valid bind returns key version 1'
);

SELECT is(
  (SELECT count(*) FROM ticketing.outbox WHERE (payload->>'ticketId')::uuid = '00000000-0000-4000-8000-000000000040'::uuid),
  1::bigint,
  '1 outbox row for ticket after bind'
);

SELECT is(
  (SELECT type FROM ticketing.outbox WHERE (payload->>'ticketId')::uuid = '00000000-0000-4000-8000-000000000040'::uuid),
  'ticket.bound',
  'type is ticket.bound'
);

SELECT is(
  (SELECT payload->>'type' FROM ticketing.outbox WHERE (payload->>'ticketId')::uuid = '00000000-0000-4000-8000-000000000040'::uuid),
  'ticket.bound',
  'payload type is ticket.bound'
);

SELECT is(
  (SELECT (payload->>'ticketId')::uuid FROM ticketing.outbox WHERE (payload->>'ticketId')::uuid = '00000000-0000-4000-8000-000000000040'::uuid),
  '00000000-0000-4000-8000-000000000040'::uuid,
  'payload ticketId matches'
);

SELECT is(
  (SELECT (payload->>'eventId')::uuid FROM ticketing.outbox WHERE (payload->>'ticketId')::uuid = '00000000-0000-4000-8000-000000000040'::uuid),
  '00000000-0000-4000-8000-000000000010'::uuid,
  'payload eventId matches'
);

SELECT is(
  (SELECT (payload->>'keyVersion')::int FROM ticketing.outbox WHERE (payload->>'ticketId')::uuid = '00000000-0000-4000-8000-000000000040'::uuid),
  1,
  'payload keyVersion is 1'
);

SELECT is(
  (SELECT payload->>'reason' FROM ticketing.outbox WHERE (payload->>'ticketId')::uuid = '00000000-0000-4000-8000-000000000040'::uuid),
  'bind',
  'payload reason is bind'
);

SELECT ok(
  (SELECT payload->>'occurredAt' IS NOT NULL FROM ticketing.outbox WHERE (payload->>'ticketId')::uuid = '00000000-0000-4000-8000-000000000040'::uuid),
  'occurredAt is not null'
);

-- 2. Recovery -> ticket.bound with reason 'recovery', keyVersion 2
SELECT is(
  (SELECT ticketing.bind('00000000-0000-4000-8000-000000000040', decode('2222222222222222222222222222222222222222222222222222222222222222', 'hex'), 'recovery')),
  2::smallint,
  'recovery returns key version 2'
);

SELECT is(
  (SELECT count(*) FROM ticketing.outbox WHERE (payload->>'ticketId')::uuid = '00000000-0000-4000-8000-000000000040'::uuid),
  2::bigint,
  '2 outbox rows for ticket after recovery'
);

SELECT is(
  (SELECT type FROM ticketing.outbox
    WHERE (payload->>'ticketId')::uuid = '00000000-0000-4000-8000-000000000040'::uuid
      AND (payload->>'keyVersion')::int = 2),
  'ticket.bound',
  'type is ticket.bound for recovery'
);

SELECT is(
  (SELECT payload->>'type' FROM ticketing.outbox
    WHERE (payload->>'ticketId')::uuid = '00000000-0000-4000-8000-000000000040'::uuid
      AND (payload->>'keyVersion')::int = 2),
  'ticket.bound',
  'payload type is ticket.bound for recovery'
);

SELECT is(
  (SELECT (payload->>'eventId')::uuid FROM ticketing.outbox
    WHERE (payload->>'ticketId')::uuid = '00000000-0000-4000-8000-000000000040'::uuid
      AND (payload->>'keyVersion')::int = 2),
  '00000000-0000-4000-8000-000000000010'::uuid,
  'payload eventId matches for recovery'
);

SELECT is(
  (SELECT (payload->>'keyVersion')::int FROM ticketing.outbox
    WHERE (payload->>'ticketId')::uuid = '00000000-0000-4000-8000-000000000040'::uuid
      AND (payload->>'keyVersion')::int = 2),
  2,
  'payload keyVersion is 2 for recovery'
);

SELECT is(
  (SELECT payload->>'reason' FROM ticketing.outbox
    WHERE (payload->>'ticketId')::uuid = '00000000-0000-4000-8000-000000000040'::uuid
      AND (payload->>'keyVersion')::int = 2),
  'recovery',
  'payload reason is recovery'
);

SELECT ok(
  (SELECT payload->>'occurredAt' IS NOT NULL FROM ticketing.outbox
    WHERE (payload->>'ticketId')::uuid = '00000000-0000-4000-8000-000000000040'::uuid
      AND (payload->>'keyVersion')::int = 2),
  'occurredAt is not null for recovery'
);

-- 3. Transfer -> ticket.transferred, keyVersion 3, without key 'reason'
SELECT is(
  (SELECT ticketing.bind('00000000-0000-4000-8000-000000000040', decode('3333333333333333333333333333333333333333333333333333333333333333', 'hex'), 'transfer')),
  3::smallint,
  'transfer returns key version 3'
);

SELECT is(
  (SELECT count(*) FROM ticketing.outbox WHERE (payload->>'ticketId')::uuid = '00000000-0000-4000-8000-000000000040'::uuid),
  3::bigint,
  '3 outbox rows for ticket after transfer'
);

SELECT is(
  (SELECT type FROM ticketing.outbox
    WHERE (payload->>'ticketId')::uuid = '00000000-0000-4000-8000-000000000040'::uuid
      AND (payload->>'keyVersion')::int = 3),
  'ticket.transferred',
  'type is ticket.transferred'
);

SELECT is(
  (SELECT payload->>'type' FROM ticketing.outbox
    WHERE (payload->>'ticketId')::uuid = '00000000-0000-4000-8000-000000000040'::uuid
      AND (payload->>'keyVersion')::int = 3),
  'ticket.transferred',
  'payload type is ticket.transferred'
);

SELECT is(
  (SELECT (payload->>'eventId')::uuid FROM ticketing.outbox
    WHERE (payload->>'ticketId')::uuid = '00000000-0000-4000-8000-000000000040'::uuid
      AND (payload->>'keyVersion')::int = 3),
  '00000000-0000-4000-8000-000000000010'::uuid,
  'payload eventId matches for transfer'
);

SELECT is(
  (SELECT (payload->>'keyVersion')::int FROM ticketing.outbox
    WHERE (payload->>'ticketId')::uuid = '00000000-0000-4000-8000-000000000040'::uuid
      AND (payload->>'keyVersion')::int = 3),
  3,
  'payload keyVersion is 3 for transfer'
);

SELECT ok(
  (SELECT (payload ? 'reason') IS FALSE FROM ticketing.outbox
    WHERE (payload->>'ticketId')::uuid = '00000000-0000-4000-8000-000000000040'::uuid
      AND (payload->>'keyVersion')::int = 3),
  'transfer payload does not have reason key'
);

SELECT ok(
  (SELECT payload->>'occurredAt' IS NOT NULL FROM ticketing.outbox
    WHERE (payload->>'ticketId')::uuid = '00000000-0000-4000-8000-000000000040'::uuid
      AND (payload->>'keyVersion')::int = 3),
  'occurredAt is not null for transfer'
);

-- 4. Failed bindings leave no new outbox row
SELECT throws_ok(
  $$ SELECT ticketing.bind('00000000-0000-4000-8000-000000000041', decode('4444444444444444444444444444444444444444444444444444444444444444', 'hex'), 'bind') $$,
  '23001', NULL, 'bind on void ticket throws restrict_violation'
);

SELECT is(
  (SELECT count(*) FROM ticketing.outbox WHERE (payload->>'ticketId')::uuid = '00000000-0000-4000-8000-000000000041'::uuid),
  0::bigint,
  'void ticket bind leaves no outbox row'
);

SELECT throws_ok(
  $$ SELECT ticketing.bind('00000000-0000-4000-8000-000000000040', decode('4444444444444444444444444444444444444444444444444444444444444444', 'hex'), 'invalid_reason') $$,
  '23514', NULL, 'invalid reason throws check_violation'
);

SELECT is(
  (SELECT count(*) FROM ticketing.outbox WHERE (payload->>'ticketId')::uuid = '00000000-0000-4000-8000-000000000040'::uuid),
  3::bigint,
  'failed bind leaves no extra outbox row'
);

-- 5. Every payload validates payload->>'type' = type and occurredAt is not null
SELECT is(
  (SELECT count(*) FROM ticketing.outbox
    WHERE (payload->>'ticketId')::uuid = '00000000-0000-4000-8000-000000000040'::uuid
      AND (payload->>'type' IS DISTINCT FROM type OR payload->>'occurredAt' IS NULL)),
  0::bigint,
  'every payload has matching type and non-null occurredAt'
);

SELECT * FROM finish();
ROLLBACK;
