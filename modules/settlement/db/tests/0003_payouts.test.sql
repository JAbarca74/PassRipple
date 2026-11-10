BEGIN;
SELECT plan(28);

-- ── Superuser setup ──────────────────────────────────────────────────────────
INSERT INTO identity.organizations (id, name, verified_at) VALUES
  ('00000000-0000-4000-8000-00000000000a', 'Org A', now()),
  ('00000000-0000-4000-8000-00000000000b', 'Org B', now());

INSERT INTO identity.users (id, is_admin) VALUES
  ('00000000-0000-4000-8000-00000000000c', false),
  ('00000000-0000-4000-8000-00000000000d', false),
  ('00000000-0000-4000-8000-00000000000e', true);

INSERT INTO identity.memberships (org_id, user_id) VALUES
  ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000c'),
  ('00000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-00000000000d');

-- 5% municipal tax (500 bps)
INSERT INTO jurisdictions.jurisdictions (canton_code, name, tax_rate_bps, courtesy_deduct_bps, settlement_rule) VALUES
  ('TEST-01', 'Test Canton', 500, '{}', 'next_business_day');

-- Event 10 (Org A): ended 6 days ago (past 24h claims window and past due_at).
-- Event 11 (Org A): ends in the future (inside claims window).
INSERT INTO events.events (id, org_id, canton_code, name, venue_name, starts_at, ends_at, age_rating, permitted_capacity, status, published_at) VALUES
  ('00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-00000000000a', 'TEST-01', 'Past Event', 'Venue', now() - interval '7 days', now() - interval '6 days', 'all', 100, 'on_sale', now() - interval '10 days'),
  ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-00000000000a', 'TEST-01', 'Future Event', 'Venue', now() + interval '1 day', now() + interval '2 days', 'all', 100, 'on_sale', now());

INSERT INTO catalog.ticket_types (id, event_id, name, price_crc, audience) VALUES
  ('00000000-0000-4000-8000-000000000020', '00000000-0000-4000-8000-000000000010', 'General', 5000, 'public');

INSERT INTO inventory.event_capacity (event_id, permitted_capacity, committed) VALUES
  ('00000000-0000-4000-8000-000000000010', 100, 2);

INSERT INTO inventory.holds (id, event_id, ticket_type_id, quantity, expires_at) VALUES
  ('00000000-0000-4000-8000-000000000030', '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000020', 2, now() + interval '10 min');

-- Paid order for 2 tickets: base = 2 * (5000 + 350 + 46) = 10792, plus ₡3 unique offset = 10795.
-- Total fee = 700, total fee_tax = 92, net organizer balance = 10003.
INSERT INTO orders.orders (id, event_id, hold_id, contact_email, access_token_hash, pay_code, amount_crc, status, idem_key, expires_at, paid_at) VALUES
  ('00000000-0000-4000-8000-000000000040', '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000030', 'buyer@example.com', sha256('order-tok-1'), 'PAY001', 10795, 'paid', 'idem-payouts-1', now() + interval '10 min', now() - interval '6 days');

INSERT INTO orders.order_items (order_id, ticket_type_id, quantity, unit_price_crc, unit_fee_crc, unit_fee_tax_crc, fee_rule) VALUES
  ('00000000-0000-4000-8000-000000000040', '00000000-0000-4000-8000-000000000020', 2, 5000, 350, 46, 'standard_v1');

-- The bank notice and the confirmed payment: record_sale takes the reference from here.
INSERT INTO payments.bank_notices (id, source, reference, amount_crc, raw_sha256, status) VALUES
  ('00000000-0000-4000-8000-000000000071', 'manual', 'BNCR-REF-1', 10795, sha256('notice-1'), 'applied');
INSERT INTO payments.payments (id, order_id, notice_id, amount_crc) VALUES
  ('00000000-0000-4000-8000-000000000070', '00000000-0000-4000-8000-000000000040',
   '00000000-0000-4000-8000-000000000071', 10795);

-- ── 1. record_sale and idempotency ───────────────────────────────────────────
SET LOCAL SESSION AUTHORIZATION passripple_api;

SELECT identity.set_actor('00000000-0000-4000-8000-00000000000e', 'admin');
SELECT throws_ok(
  $$ SELECT settlement.record_sale(
       '00000000-0000-4000-8000-000000000060',
       '00000000-0000-4000-8000-000000000070',
       '00000000-0000-4000-8000-000000000040',
       '00000000-0000-4000-8000-000000000010',
       10795) $$,
  '42501', NULL, 'non-system actor cannot call record_sale'
);

SELECT identity.set_actor(NULL, 'system');
SELECT throws_ok(
  $$ SELECT settlement.record_sale(
       '00000000-0000-4000-8000-000000000062',
       '00000000-0000-4000-8000-000000000070',
       '00000000-0000-4000-8000-000000000041',
       '00000000-0000-4000-8000-000000000010',
       10795) $$,
  '55000', NULL, 'a payment cannot be booked for another order'
);
SELECT throws_ok(
  $$ SELECT settlement.record_sale(
       '00000000-0000-4000-8000-000000000063',
       '00000000-0000-4000-8000-000000000070',
       '00000000-0000-4000-8000-000000000040',
       '00000000-0000-4000-8000-000000000010',
       99999) $$,
  '55000', NULL, 'a payment cannot be booked for another amount'
);
SELECT is(
  settlement.record_sale(
    '00000000-0000-4000-8000-000000000060',
    '00000000-0000-4000-8000-000000000070',
    '00000000-0000-4000-8000-000000000040',
    '00000000-0000-4000-8000-000000000010',
    10795
  ),
  true,
  'record_sale books a confirmed sale and returns true'
);

SELECT identity.set_actor('00000000-0000-4000-8000-00000000000e', 'admin');
SELECT results_eq(
  $$ SELECT kind, amount_crc, reference
       FROM settlement.ledger_entries
      WHERE event_id = '00000000-0000-4000-8000-000000000010'
      ORDER BY amount_crc DESC $$,
  $$ VALUES ('payment_in'::text, 10795, 'BNCR-REF-1'::text),
            ('fee_tax'::text, -92, 'BNCR-REF-1'::text),
            ('fee'::text, -700, 'BNCR-REF-1'::text) $$,
  'record_sale inserts payment_in (+amount), fee (-fee) and fee_tax (-tax)'
);

SELECT identity.set_actor(NULL, 'system');
SELECT is(
  settlement.record_sale(
    '00000000-0000-4000-8000-000000000060',
    '00000000-0000-4000-8000-000000000070',
    '00000000-0000-4000-8000-000000000040',
    '00000000-0000-4000-8000-000000000010',
    10795
  ),
  false,
  'replaying the same message_id returns false'
);

SELECT is(
  settlement.record_sale(
    '00000000-0000-4000-8000-000000000061',
    '00000000-0000-4000-8000-000000000070',
    '00000000-0000-4000-8000-000000000040',
    '00000000-0000-4000-8000-000000000010',
    10795
  ),
  false,
  'replaying the same payment_id with a new message_id returns false'
);

SELECT identity.set_actor('00000000-0000-4000-8000-00000000000e', 'admin');
SELECT is(
  (SELECT count(*)::int FROM settlement.ledger_entries WHERE event_id = '00000000-0000-4000-8000-000000000010'),
  3,
  'replays book no extra ledger entries'
);

-- ── 2. Statement and platform_totals before payout ───────────────────────────
SELECT identity.set_actor('00000000-0000-4000-8000-00000000000c', 'organizer', '00000000-0000-4000-8000-00000000000a');
SELECT throws_ok(
  $$ SELECT * FROM settlement.platform_totals() $$,
  '42501', NULL, 'non-admin cannot call platform_totals'
);

SELECT identity.set_actor('00000000-0000-4000-8000-00000000000e', 'admin');
SELECT is(
  (SELECT ROW(custody_crc, own_income_crc, overdue_events) FROM settlement.platform_totals()),
  ROW(10795::bigint, 0::bigint, 1),
  'platform_totals before payout keeps full collected amount in custody and 0 in own_income'
);

SELECT identity.set_actor('00000000-0000-4000-8000-00000000000d', 'organizer', '00000000-0000-4000-8000-00000000000b');
SELECT throws_ok(
  $$ SELECT * FROM settlement.statement('00000000-0000-4000-8000-000000000010') $$,
  '42501', NULL, 'organizer of another org cannot read statement'
);

SELECT identity.set_actor('00000000-0000-4000-8000-00000000000c', 'organizer', '00000000-0000-4000-8000-00000000000a');
SELECT is(
  (SELECT ROW(collected_crc, fee_crc, fee_tax_crc, refunds_crc, adjustments_crc,
              paid_out_crc, balance_crc, overdue, municipal_tax_crc, payout_confirmed_at)
     FROM settlement.statement('00000000-0000-4000-8000-000000000010')),
  ROW(10795, 700, 92, 0, 0, 0, 10003, true, 500, NULL::timestamptz),
  'statement before payout reports figures, overdue = true and municipal_tax = round(10003 * 5%)'
);

-- ── 3. Payout window, invariant I9 and exact payout ──────────────────────────
SELECT throws_ok(
  $$ SELECT settlement.record_payout('00000000-0000-4000-8000-000000000010', 10003, 'SINPE-ORG') $$,
  '42501', NULL, 'organizer cannot record a payout'
);

SELECT identity.set_actor('00000000-0000-4000-8000-00000000000e', 'admin');
SELECT throws_ok(
  $$ SELECT settlement.record_payout('00000000-0000-4000-8000-000000000011', 1000, 'SINPE-EARLY') $$,
  '55000', NULL, 'payout before 24h claims window closes is rejected'
);

SELECT throws_ok(
  $$ SELECT settlement.record_payout('00000000-0000-4000-8000-000000000010', 10004, 'SINPE-OVER') $$,
  '23514', NULL, 'I9: payout above balance is rejected with check_violation'
);

SELECT identity.set_actor(NULL, 'system');
SELECT throws_ok(
  $$ SELECT settlement.record_entry('00000000-0000-4000-8000-000000000010', 'refund', -10004, 'REF-OVER', NULL) $$,
  '23514', NULL, 'I9: refund making balance negative is rejected with check_violation'
);

SELECT identity.set_actor('00000000-0000-4000-8000-00000000000e', 'admin');
SELECT throws_ok(
  $$ SELECT settlement.record_entry('00000000-0000-4000-8000-000000000010', 'adjustment', -10004, NULL, 'over balance') $$,
  '23514', NULL, 'I9: negative adjustment making balance negative is rejected'
);

SELECT isnt(
  settlement.record_payout('00000000-0000-4000-8000-000000000010', 10003, 'SINPE-EXACT'),
  NULL,
  'exact-balance payout succeeds'
);

-- ── 4. Confirming the payout ─────────────────────────────────────────────────
SELECT identity.set_actor('00000000-0000-4000-8000-00000000000d', 'organizer', '00000000-0000-4000-8000-00000000000b');
SELECT throws_ok(
  $$ SELECT settlement.confirm_payout('00000000-0000-4000-8000-000000000010') $$,
  '42501', NULL, 'confirm_payout by another organization is rejected'
);

SELECT identity.set_actor('00000000-0000-4000-8000-00000000000c', 'organizer', '00000000-0000-4000-8000-00000000000a');
SELECT isnt(
  settlement.confirm_payout('00000000-0000-4000-8000-000000000010'),
  NULL,
  'confirm_payout by the owning organization succeeds once'
);

SELECT throws_ok(
  $$ SELECT settlement.confirm_payout('00000000-0000-4000-8000-000000000010') $$,
  '55000', NULL, 'confirm_payout a second time is rejected'
);

-- ── 5. Statement and platform_totals after payout ────────────────────────────
SELECT is(
  (SELECT ROW(collected_crc, fee_crc, fee_tax_crc, refunds_crc, adjustments_crc,
              paid_out_crc, balance_crc, overdue, municipal_tax_crc, payout_confirmed_at IS NOT NULL)
     FROM settlement.statement('00000000-0000-4000-8000-000000000010')),
  ROW(10795, 700, 92, 0, 0, 10003, 0, false, 500, true),
  'statement after payout and confirmation shows 0 balance, not overdue and confirmed'
);

SELECT identity.set_actor('00000000-0000-4000-8000-00000000000e', 'admin');
SELECT is(
  (SELECT ROW(custody_crc, own_income_crc, overdue_events) FROM settlement.platform_totals()),
  ROW(0::bigint, 792::bigint, 0),
  'platform_totals after payout moves fee + fee_tax (792) from custody to own_income'
);

-- ── 6. RLS isolation and payout immutability ─────────────────────────────────
SELECT identity.set_actor('00000000-0000-4000-8000-00000000000d', 'organizer', '00000000-0000-4000-8000-00000000000b');
SELECT is(
  (SELECT count(*)::int FROM settlement.ledger_entries WHERE event_id = '00000000-0000-4000-8000-000000000010'),
  0,
  'organizer of Org B sees no rows of Org A in ledger_entries'
);
SELECT is(
  (SELECT count(*)::int FROM settlement.payouts WHERE event_id = '00000000-0000-4000-8000-000000000010'),
  0,
  'organizer of Org B sees no rows of Org A in payouts'
);

SELECT identity.set_actor('00000000-0000-4000-8000-00000000000c', 'organizer', '00000000-0000-4000-8000-00000000000a');
SELECT is(
  (SELECT ROW(
     (SELECT count(*)::int FROM settlement.ledger_entries WHERE event_id = '00000000-0000-4000-8000-000000000010'),
     (SELECT count(*)::int FROM settlement.payouts WHERE event_id = '00000000-0000-4000-8000-000000000010')
   )),
  ROW(4, 1),
  'organizer of Org A sees all 4 ledger entries and the payout of its event'
);

RESET SESSION AUTHORIZATION;
SET LOCAL ROLE passripple_owner_settlement;

SELECT throws_ok(
  $$ UPDATE settlement.payouts SET confirmed_at = now() WHERE event_id = '00000000-0000-4000-8000-000000000010' $$,
  '23001', NULL, 'owner cannot update an already confirmed payout'
);
SELECT throws_ok(
  $$ DELETE FROM settlement.payouts WHERE event_id = '00000000-0000-4000-8000-000000000010' $$,
  '23001', NULL, 'owner cannot delete a payout'
);

RESET ROLE;

SELECT * FROM finish(true);
ROLLBACK;
