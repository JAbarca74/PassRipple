-- Invariant I9 under concurrency (ADR 0011, ADR 0039): two concurrent payouts for the
-- same event, each within the current balance (600 <= 1000) but together exceeding it
-- (600 + 600 > 1000). The per-event transaction advisory lock in settlement.enforce_i9
-- serializes them so only the first succeeds and the second is rejected by I9.
BEGIN;
SELECT plan(6);

CREATE FUNCTION pg_temp.cleanup_i9() RETURNS text LANGUAGE sql AS $f$
  SELECT dblink_exec('setup', $c$
    SET session_replication_role = replica;
    DELETE FROM settlement.payouts WHERE event_id = '00000000-0000-4000-8000-0000000c9010';
    DELETE FROM settlement.ledger_entries WHERE event_id = '00000000-0000-4000-8000-0000000c9010';
    DELETE FROM events.events WHERE id = '00000000-0000-4000-8000-0000000c9010';
    DELETE FROM identity.users WHERE id = '00000000-0000-4000-8000-0000000c900e';
    DELETE FROM identity.organizations WHERE id = '00000000-0000-4000-8000-0000000c900a';
    DELETE FROM jurisdictions.jurisdictions WHERE canton_code = 'CONC-I9';
    RESET session_replication_role;
  $c$);
$f$;

SELECT dblink_connect(name, format('dbname=%s user=%s', current_database(),
                                   (SELECT rolname FROM pg_roles WHERE oid = 10)))
  FROM unnest(ARRAY['setup', 'a', 'b']) AS name;
SELECT pg_temp.cleanup_i9();

-- Event ended 3 days ago with a custody balance of ₡1,000.
SELECT dblink_exec('setup', $$
  INSERT INTO jurisdictions.jurisdictions (canton_code, name, tax_rate_bps, courtesy_deduct_bps, settlement_rule)
  VALUES ('CONC-I9', 'Concurrency I9', 0, '{}', 'next_business_day');
  INSERT INTO identity.organizations (id, name, verified_at)
  VALUES ('00000000-0000-4000-8000-0000000c900a', 'Concurrency Org', now());
  INSERT INTO identity.users (id, is_admin)
  VALUES ('00000000-0000-4000-8000-0000000c900e', true);
  INSERT INTO events.events (id, org_id, canton_code, name, venue_name, starts_at, ends_at,
                             age_rating, permitted_capacity, status, published_at, permit_number)
  VALUES ('00000000-0000-4000-8000-0000000c9010', '00000000-0000-4000-8000-0000000c900a', 'CONC-I9',
          'Concurrency Event', 'Venue', now() - interval '4 days', now() - interval '3 days',
          'all', 10, 'on_sale', now() - interval '5 days', 'P-I9');
  INSERT INTO settlement.ledger_entries (id, event_id, kind, amount_crc, reference)
  VALUES ('00000000-0000-4000-8000-0000000c9020', '00000000-0000-4000-8000-0000000c9010',
          'payment_in', 1000, 'REF-INIT');
$$);

-- Both racers act as the API, as the administrator.
SELECT dblink_exec(name, 'BEGIN'),
       dblink_exec(name, 'SET LOCAL SESSION AUTHORIZATION passripple_api'),
       (SELECT x FROM dblink(name, $$SELECT identity.set_actor('00000000-0000-4000-8000-0000000c900e', 'admin')::text$$) AS t(x text))
  FROM unnest(ARRAY['a', 'b']) AS name;

-- A records a payout of ₡600 (within the ₡1,000 balance) and keeps its transaction open,
-- holding the event's advisory lock.
SELECT isnt(
  (SELECT p FROM dblink('a', $$SELECT settlement.record_payout('00000000-0000-4000-8000-0000000c9010', 600, 'SINPE-A')::text$$) AS t(p text)),
  NULL,
  'the first payout of 600 within balance 1000 succeeds'
);

-- B tries to record a payout of ₡600 concurrently.
SELECT dblink_send_query('b', $$SELECT settlement.record_payout('00000000-0000-4000-8000-0000000c9010', 600, 'SINPE-B')::text$$);
SELECT pg_sleep(0.3);
SELECT is(dblink_is_busy('b'), 1, 'the second payout waits for the event advisory lock');

SELECT dblink_exec('a', 'COMMIT');

SELECT is(
  (SELECT count(*)::int FROM dblink_get_result('b', false) AS t(p text)),
  0,
  'once the first commits, the second payout fails'
);
SELECT ok(
  dblink_error_message('b') LIKE '%I9:%',
  'the second payout is rejected by invariant I9 (check_violation)'
);
SELECT * FROM dblink_get_result('b', false) AS t(p text);
SELECT dblink_exec('b', 'ROLLBACK');

SELECT is(
  (SELECT count(*)::int FROM settlement.payouts WHERE event_id = '00000000-0000-4000-8000-0000000c9010'),
  1,
  'exactly one payout row exists for the event'
);
SELECT is(
  (SELECT coalesce(sum(amount_crc), 0)::int
     FROM settlement.ledger_entries
    WHERE event_id = '00000000-0000-4000-8000-0000000c9010' AND kind <> 'door_sale'),
  400,
  'the remaining ledger balance is 400 and never became negative'
);

SELECT pg_temp.cleanup_i9();
SELECT dblink_disconnect(name) FROM unnest(ARRAY['setup', 'a', 'b']) AS name;

SELECT * FROM finish(true);
ROLLBACK;
