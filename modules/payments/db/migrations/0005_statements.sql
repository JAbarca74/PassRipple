-- Reconciliation against the bank statement (design 10.4). A notice proves nothing on its
-- own: an SMS can be forged. Before an event is settled, every payment confirmed in a period
-- must appear in the account's real movements, downloaded from online banking. An
-- administrator imports the statement's credits for a period; every payment of that period
-- whose notice reference is not among them, or is there with another amount, becomes an
-- incident for a person to resolve (voiding the tickets is their call, through ticketing).
--
-- The lines arrive already parsed: the bank's export format belongs to a parser in
-- @passripple/bank-parsers, written when a real, anonymized export exists.

-- One imported statement: the period it covers and the hash of what was imported, so the
-- same file imported twice is one statement. Append-only.
CREATE TABLE payments.statements (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  covers_from date        NOT NULL,
  covers_to   date        NOT NULL,
  raw_sha256  bytea       NOT NULL UNIQUE CHECK (length(raw_sha256) = 32),
  imported_by uuid        NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  CHECK (covers_to >= covers_from),
  CHECK (covers_to - covers_from <= 92)
);

-- The statement's credits. The description is the bank's or the payer's text: stored,
-- never interpreted. Append-only.
CREATE TABLE payments.statement_lines (
  statement_id uuid    NOT NULL REFERENCES payments.statements (id),
  line_no      integer NOT NULL CHECK (line_no >= 1),
  booked_on    date    NOT NULL,
  reference    text    NOT NULL CHECK (btrim(reference) <> '' AND length(reference) <= 64),
  amount_crc   integer NOT NULL CHECK (amount_crc > 0),
  description  text    CHECK (length(description) <= 500),
  PRIMARY KEY (statement_id, line_no)
);
CREATE INDEX statement_lines_reference_idx ON payments.statement_lines (reference);

-- A confirmed payment the statement does not back. One per payment; resolved by a person.
CREATE TABLE payments.statement_incidents (
  payment_id   uuid        PRIMARY KEY REFERENCES payments.payments (id),
  statement_id uuid        NOT NULL REFERENCES payments.statements (id),
  -- missing: no credit with the notice's reference; amount_differs: there is one, with
  -- another amount.
  finding      text        NOT NULL CHECK (finding IN ('missing', 'amount_differs')),
  detected_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER statements_append_only BEFORE UPDATE OR DELETE ON payments.statements
  FOR EACH ROW EXECUTE FUNCTION app.reject_mutation();
CREATE TRIGGER statements_no_truncate BEFORE TRUNCATE ON payments.statements
  FOR EACH STATEMENT EXECUTE FUNCTION app.reject_mutation();
CREATE TRIGGER statement_lines_append_only BEFORE UPDATE OR DELETE ON payments.statement_lines
  FOR EACH ROW EXECUTE FUNCTION app.reject_mutation();
CREATE TRIGGER statement_lines_no_truncate BEFORE TRUNCATE ON payments.statement_lines
  FOR EACH STATEMENT EXECUTE FUNCTION app.reject_mutation();
CREATE TRIGGER statement_incidents_append_only BEFORE UPDATE OR DELETE ON payments.statement_incidents
  FOR EACH ROW EXECUTE FUNCTION app.reject_mutation();
CREATE TRIGGER statement_incidents_no_truncate BEFORE TRUNCATE ON payments.statement_incidents
  FOR EACH STATEMENT EXECUTE FUNCTION app.reject_mutation();

ALTER TABLE payments.statements          ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
ALTER TABLE payments.statement_lines     ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
ALTER TABLE payments.statement_incidents ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
CREATE POLICY statements_module_read ON payments.statements FOR SELECT USING (app.is_module_role());
CREATE POLICY statements_module_write ON payments.statements TO passripple_owner_payments
  USING (true) WITH CHECK (true);
CREATE POLICY statement_lines_module_read ON payments.statement_lines FOR SELECT
  USING (app.is_module_role());
CREATE POLICY statement_lines_module_write ON payments.statement_lines TO passripple_owner_payments
  USING (true) WITH CHECK (true);
CREATE POLICY statement_incidents_module_read ON payments.statement_incidents FOR SELECT
  USING (app.is_module_role());
CREATE POLICY statement_incidents_module_write ON payments.statement_incidents TO passripple_owner_payments
  USING (true) WITH CHECK (true);

-- The day a payment happened, in Costa Rica: the time the administrator typed for a manual
-- notice, the arrival of any other.
CREATE FUNCTION payments.paid_on(p_notice_id uuid)
RETURNS date
LANGUAGE sql
STABLE
SET search_path = pg_catalog
AS $$
  SELECT (coalesce(m.paid_at, n.received_at) AT TIME ZONE 'America/Costa_Rica')::date
    FROM payments.bank_notices n
    LEFT JOIN payments.manual_entries m ON m.notice_id = n.id
   WHERE n.id = p_notice_id;
$$;

-- Imports a statement's credits for [p_from, p_to] and records an incident for every payment
-- of those days that it does not back. p_lines: [{"bookedOn": "2026-11-07", "reference":
-- "…", "amountCrc": 2500, "description": "…"}, …]. The same import again (same hash) changes
-- nothing and reports the same findings. Returns the statement's id.
CREATE FUNCTION payments.import_statement(
  p_from date, p_to date, p_lines jsonb, p_raw_sha256 bytea
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_id   uuid;
  v_line jsonb;
  v_no   integer := 0;
  v_on   date;
BEGIN
  IF app.actor_role() IS DISTINCT FROM 'admin' OR app.actor_id() IS NULL THEN
    RAISE EXCEPTION 'only a platform administrator imports statements' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF jsonb_typeof(p_lines) IS DISTINCT FROM 'array' OR jsonb_array_length(p_lines) > 5000 THEN
    RAISE EXCEPTION 'a statement carries at most 5000 lines' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT s.id INTO v_id FROM payments.statements s WHERE s.raw_sha256 = p_raw_sha256;
  IF FOUND THEN
    RETURN v_id;
  END IF;

  INSERT INTO payments.statements (covers_from, covers_to, raw_sha256, imported_by)
  VALUES (p_from, p_to, p_raw_sha256, app.actor_id())
  RETURNING id INTO v_id;
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_no := v_no + 1;
    v_on := (v_line ->> 'bookedOn')::date;
    IF v_on NOT BETWEEN p_from AND p_to THEN
      RAISE EXCEPTION 'line % is booked on %, outside the statement''s period', v_no, v_on
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
    INSERT INTO payments.statement_lines (statement_id, line_no, booked_on, reference, amount_crc,
                                          description)
    VALUES (v_id, v_no, v_on, v_line ->> 'reference', (v_line ->> 'amountCrc')::integer,
            nullif(v_line ->> 'description', ''));
  END LOOP;

  -- Every payment of the period, against every credit imported for that period so far: a
  -- payment backed by an earlier statement of overlapping days is not an incident.
  INSERT INTO payments.statement_incidents (payment_id, statement_id, finding)
  SELECT p.id, v_id,
         CASE WHEN EXISTS (
                SELECT 1 FROM payments.statement_lines l
                  JOIN payments.statements s ON s.id = l.statement_id
                 WHERE l.reference = n.reference AND s.covers_from <= p_to AND s.covers_to >= p_from)
              THEN 'amount_differs' ELSE 'missing' END
    FROM payments.payments p
    JOIN payments.bank_notices n ON n.id = p.notice_id
   WHERE payments.paid_on(n.id) BETWEEN p_from AND p_to
     AND NOT EXISTS (
           SELECT 1 FROM payments.statement_lines l
             JOIN payments.statements s ON s.id = l.statement_id
            WHERE l.reference = n.reference AND l.amount_crc = n.amount_crc
              AND l.booked_on BETWEEN payments.paid_on(n.id) - 1 AND payments.paid_on(n.id) + 3)
  ON CONFLICT (payment_id) DO NOTHING;
  RETURN v_id;
END
$$;

-- What a statement left unresolved: the incidents of payments in its period, with the order
-- they paid. For the administrator.
CREATE FUNCTION payments.statement_findings(p_statement_id uuid)
RETURNS TABLE (order_code text, reference text, amount_crc integer, paid_on date, finding text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
#variable_conflict use_column
DECLARE
  v_statement payments.statements;
BEGIN
  IF app.actor_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'only a platform administrator reads statement findings' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO v_statement FROM payments.statements s WHERE s.id = p_statement_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'statement % does not exist', p_statement_id USING ERRCODE = 'no_data_found';
  END IF;
  RETURN QUERY
    SELECT o.pay_code, n.reference, n.amount_crc, payments.paid_on(n.id), i.finding
      FROM payments.statement_incidents i
      JOIN payments.payments p ON p.id = i.payment_id
      JOIN payments.bank_notices n ON n.id = p.notice_id
      JOIN orders.orders o ON o.id = p.order_id
     WHERE payments.paid_on(n.id) BETWEEN v_statement.covers_from AND v_statement.covers_to
     ORDER BY 4, 2;
END
$$;

GRANT EXECUTE ON FUNCTION payments.import_statement(date, date, jsonb, bytea) TO passripple_api;
GRANT EXECUTE ON FUNCTION payments.statement_findings(uuid) TO passripple_api;
