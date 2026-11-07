BEGIN;
SELECT plan(22);

-- ── Superuser setup ──────────────────────────────────────────────────────────
INSERT INTO identity.organizations (id, name, verified_at) VALUES
  ('00000000-0000-4000-8000-00000000000a', 'Org 1', now());
INSERT INTO identity.users (id, is_admin) VALUES
  ('00000000-0000-4000-8000-00000000000b', true),
  ('00000000-0000-4000-8000-00000000000c', false);
INSERT INTO jurisdictions.jurisdictions (canton_code, name, tax_rate_bps, courtesy_deduct_bps, settlement_rule) VALUES
  ('TEST-01', 'Test', 0, '{}', 'next_business_day');
INSERT INTO events.events (id, org_id, canton_code, name, venue_name, starts_at, age_rating, permitted_capacity, status, published_at) VALUES
  ('00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-00000000000a', 'TEST-01', 'Event 1', 'Venue', now() + interval '1 day', 'all', 10, 'on_sale', now());
INSERT INTO catalog.ticket_types (id, event_id, name, price_crc, audience) VALUES
  ('00000000-0000-4000-8000-000000000020', '00000000-0000-4000-8000-000000000010', 'Public 1', 1000, 'public');
INSERT INTO inventory.event_capacity (event_id, permitted_capacity, committed) VALUES
  ('00000000-0000-4000-8000-000000000010', 10, 3);

INSERT INTO inventory.holds (id, event_id, ticket_type_id, quantity, expires_at) VALUES
  ('00000000-0000-4000-8000-000000000030', '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000020', 1, now() + interval '1 hour'),
  ('00000000-0000-4000-8000-000000000031', '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000020', 1, now() + interval '1 hour'),
  ('00000000-0000-4000-8000-000000000032', '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000020', 1, now() + interval '1 hour');

INSERT INTO orders.orders (id, event_id, hold_id, contact_email, access_token_hash, pay_code, amount_crc, idem_key, expires_at) VALUES
  ('00000000-0000-4000-8000-000000000040', '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000030', 'buyer@example.com', sha256('tok1'), 'CODE1', 1000, 'idem_key_01', now() + interval '1 hour'),
  ('00000000-0000-4000-8000-000000000041', '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000031', 'buyer@example.com', sha256('tok2'), 'CODE2', 1000, 'idem_key_02', now() + interval '1 hour'),
  ('00000000-0000-4000-8000-000000000042', '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000032', 'buyer@example.com', sha256('tok3'), 'CODE3', 1000, 'idem_key_03', now() + interval '1 hour');

CREATE TEMPORARY TABLE test_data (
  name text PRIMARY KEY,
  id   uuid NOT NULL
);

-- ── Prepara 3 órdenes pagadas con record_manual_notice y reconcile ───────────
SELECT identity.set_actor('00000000-0000-4000-8000-00000000000b', 'admin');

INSERT INTO test_data (name, id) VALUES
  ('n1', payments.record_manual_notice('R1', 1000, 'pay CODE1', 'Payer 1', NULL, now() - interval '1 hour', sha256('raw1'))),
  ('n2', payments.record_manual_notice('R2', 1000, 'pay CODE2', 'Payer 2', NULL, now() - interval '1 hour', sha256('raw2'))),
  ('n3', payments.record_manual_notice('R3', 1000, 'pay CODE3', 'Payer 3', NULL, now() - interval '1 hour', sha256('raw3')));

SELECT identity.set_actor(NULL, 'system');

SELECT is(
  (SELECT result FROM payments.reconcile((SELECT id FROM test_data WHERE name = 'n1'), ARRAY['CODE1'])),
  'paid',
  'order 1 reconciled as paid'
);

SELECT is(
  (SELECT result FROM payments.reconcile((SELECT id FROM test_data WHERE name = 'n2'), ARRAY['CODE2'])),
  'paid',
  'order 2 reconciled as paid'
);

SELECT is(
  (SELECT result FROM payments.reconcile((SELECT id FROM test_data WHERE name = 'n3'), ARRAY['CODE3'])),
  'paid',
  'order 3 reconciled as paid'
);

-- ── Import statement con R1 1000 y R2 999 ─────────────────────────────────────
SELECT identity.set_actor('00000000-0000-4000-8000-00000000000b', 'admin');

DO $$
DECLARE
  v_today date := (now() AT TIME ZONE 'America/Costa_Rica')::date;
  v_lines jsonb;
  v_stmt_id uuid;
BEGIN
  v_lines := jsonb_build_array(
    jsonb_build_object('bookedOn', to_char(v_today, 'YYYY-MM-DD'), 'reference', 'R1', 'amountCrc', 1000, 'description', 'Credit R1'),
    jsonb_build_object('bookedOn', to_char(v_today, 'YYYY-MM-DD'), 'reference', 'R2', 'amountCrc', 999, 'description', 'Credit R2')
  );
  v_stmt_id := payments.import_statement(v_today - 1, v_today + 1, v_lines, sha256('stmt_raw_01'));
  INSERT INTO test_data (name, id) VALUES ('stmt', v_stmt_id);
END $$;

-- statement_findings: R2 is amount_differs, R3 is missing, R1 does not appear
SELECT is(
  (SELECT count(*)::int FROM payments.statement_findings((SELECT id FROM test_data WHERE name = 'stmt'))),
  2,
  'findings has 2 rows (R1 does not appear)'
);

SELECT is(
  (SELECT finding FROM payments.statement_findings((SELECT id FROM test_data WHERE name = 'stmt')) WHERE reference = 'R2'),
  'amount_differs',
  'R2 finding is amount_differs'
);

SELECT is(
  (SELECT finding FROM payments.statement_findings((SELECT id FROM test_data WHERE name = 'stmt')) WHERE reference = 'R3'),
  'missing',
  'R3 finding is missing'
);

SELECT is(
  (SELECT count(*)::int FROM payments.statement_findings((SELECT id FROM test_data WHERE name = 'stmt')) WHERE reference = 'R1'),
  0,
  'R1 is backed and does not appear in findings'
);

-- ── Mismo raw_sha256 otra vez: mismo id, sin incidentes nuevos ────────────────
DO $$
DECLARE
  v_today date := (now() AT TIME ZONE 'America/Costa_Rica')::date;
  v_lines jsonb;
  v_reimport_id uuid;
BEGIN
  v_lines := jsonb_build_array(
    jsonb_build_object('bookedOn', to_char(v_today, 'YYYY-MM-DD'), 'reference', 'R1', 'amountCrc', 1000, 'description', 'Credit R1')
  );
  v_reimport_id := payments.import_statement(v_today - 1, v_today + 1, v_lines, sha256('stmt_raw_01'));
  INSERT INTO test_data (name, id) VALUES ('reimport', v_reimport_id);
END $$;

SELECT is(
  (SELECT id FROM test_data WHERE name = 'reimport'),
  (SELECT id FROM test_data WHERE name = 'stmt'),
  'reimporting same raw_sha256 returns same statement id'
);

SELECT is(
  (SELECT count(*)::int FROM payments.statement_incidents WHERE statement_id = (SELECT id FROM test_data WHERE name = 'stmt')),
  2,
  'no additional incidents inserted on reimport'
);

-- ── Validaciones de error ────────────────────────────────────────────────────
-- Línea fuera del período (22023)
SELECT throws_ok(
  $$ SELECT payments.import_statement(
       (now() AT TIME ZONE 'America/Costa_Rica')::date,
       (now() AT TIME ZONE 'America/Costa_Rica')::date,
       jsonb_build_array(jsonb_build_object('bookedOn', to_char((now() AT TIME ZONE 'America/Costa_Rica')::date + 2, 'YYYY-MM-DD'), 'reference', 'R_OUT', 'amountCrc', 1000)),
       sha256('out_of_period')
     ) $$,
  '22023', NULL, 'line booked outside period throws 22023'
);

-- Más de 5000 líneas (22023)
SELECT throws_ok(
  $$ SELECT payments.import_statement(
       (now() AT TIME ZONE 'America/Costa_Rica')::date,
       (now() AT TIME ZONE 'America/Costa_Rica')::date,
       (SELECT jsonb_agg(jsonb_build_object('bookedOn', to_char((now() AT TIME ZONE 'America/Costa_Rica')::date, 'YYYY-MM-DD'), 'reference', 'R' || i, 'amountCrc', 1000)) FROM generate_series(1, 5001) i),
       sha256('too_many_lines')
     ) $$,
  '22023', NULL, 'more than 5000 lines throws 22023'
);

-- Actor no admin en import_statement (42501)
SELECT identity.set_actor(NULL, 'system');
SELECT throws_ok(
  $$ SELECT payments.import_statement(
       (now() AT TIME ZONE 'America/Costa_Rica')::date,
       (now() AT TIME ZONE 'America/Costa_Rica')::date,
       '[]'::jsonb,
       sha256('system_import')
     ) $$,
  '42501', NULL, 'system actor cannot import statement'
);

-- Actor no admin en statement_findings (42501)
SELECT throws_ok(
  $$ SELECT * FROM payments.statement_findings('00000000-0000-4000-8000-000000000001'::uuid) $$,
  '42501', NULL, 'system actor cannot read statement findings'
);

-- statement_findings de un id inexistente (P0002)
SELECT identity.set_actor('00000000-0000-4000-8000-00000000000b', 'admin');
SELECT throws_ok(
  $$ SELECT * FROM payments.statement_findings('00000000-0000-4000-8000-000000000099'::uuid) $$,
  'P0002', NULL, 'statement_findings on nonexistent id throws P0002'
);

-- ── Rechazo de UPDATE y DELETE en tablas append-only (23001) ─────────────────
SELECT throws_ok(
  $$ UPDATE payments.statements SET covers_to = covers_to + 1 WHERE id = (SELECT id FROM test_data WHERE name = 'stmt') $$,
  '23001', NULL, 'UPDATE on statements is rejected'
);

SELECT throws_ok(
  $$ DELETE FROM payments.statements WHERE id = (SELECT id FROM test_data WHERE name = 'stmt') $$,
  '23001', NULL, 'DELETE on statements is rejected'
);

SELECT throws_ok(
  $$ UPDATE payments.statement_lines SET amount_crc = 500 WHERE statement_id = (SELECT id FROM test_data WHERE name = 'stmt') $$,
  '23001', NULL, 'UPDATE on statement_lines is rejected'
);

SELECT throws_ok(
  $$ DELETE FROM payments.statement_lines WHERE statement_id = (SELECT id FROM test_data WHERE name = 'stmt') $$,
  '23001', NULL, 'DELETE on statement_lines is rejected'
);

SELECT throws_ok(
  $$ UPDATE payments.statement_incidents SET finding = 'missing' WHERE statement_id = (SELECT id FROM test_data WHERE name = 'stmt') $$,
  '23001', NULL, 'UPDATE on statement_incidents is rejected'
);

SELECT throws_ok(
  $$ DELETE FROM payments.statement_incidents WHERE statement_id = (SELECT id FROM test_data WHERE name = 'stmt') $$,
  '23001', NULL, 'DELETE on statement_incidents is rejected'
);

SELECT * FROM finish();
ROLLBACK;
