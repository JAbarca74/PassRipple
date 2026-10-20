-- Reconciliation (design 10.3, 10.4, ADR 0034): a notice is matched to its order by the
-- payment code in its description, or, when it has none, by an amount that only one pending
-- order holds (ADR 0031). Phase 3's only channel is a platform administrator typing a notice
-- by hand; who typed it is recorded, because a hand-typed notice is trusted on their word.

-- Who entered each hand-typed notice and when the bank says it was paid. Append-only.
CREATE TABLE payments.manual_entries (
  notice_id  uuid        PRIMARY KEY REFERENCES payments.bank_notices (id),
  entered_by uuid        NOT NULL,
  paid_at    timestamptz NOT NULL,
  entered_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER manual_entries_append_only BEFORE UPDATE OR DELETE ON payments.manual_entries
  FOR EACH ROW EXECUTE FUNCTION app.reject_mutation();
CREATE TRIGGER manual_entries_no_truncate BEFORE TRUNCATE ON payments.manual_entries
  FOR EACH STATEMENT EXECUTE FUNCTION app.reject_mutation();

ALTER TABLE payments.manual_entries ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
CREATE POLICY manual_entries_module_read ON payments.manual_entries FOR SELECT
  USING (app.is_module_role());
CREATE POLICY manual_entries_module_write ON payments.manual_entries TO passripple_owner_payments
  USING (true) WITH CHECK (true);
CREATE POLICY manual_entries_api_read ON payments.manual_entries FOR SELECT TO passripple_api
  USING ((SELECT app.actor_role()) = 'admin');
GRANT SELECT ON payments.manual_entries TO passripple_api;

-- A notice typed by a platform administrator, with source 'manual'. The same notice again
-- (same reference and content) returns the same id, so typing it five times records it once
-- (I4); the same reference with other content is an error. The description is stored as the
-- payer's untrusted text and never interpreted here.
CREATE FUNCTION payments.record_manual_notice(
  p_reference text,
  p_amount_crc integer,
  p_description text,
  p_payer_name text,
  p_payer_phone text,
  p_paid_at timestamptz,
  p_raw_sha256 bytea
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_notice payments.bank_notices;
  v_id     uuid;
BEGIN
  IF app.actor_role() IS DISTINCT FROM 'admin' OR app.actor_id() IS NULL THEN
    RAISE EXCEPTION 'only a platform administrator types bank notices' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_paid_at IS NULL OR p_paid_at > now() + interval '5 minutes' THEN
    RAISE EXCEPTION 'the payment time cannot be in the future' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  INSERT INTO payments.bank_notices (source, reference, amount_crc, description, payer_name,
                                     payer_phone, raw_sha256)
  VALUES ('manual', p_reference, p_amount_crc, p_description, p_payer_name, p_payer_phone, p_raw_sha256)
  ON CONFLICT (source, reference) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    SELECT * INTO v_notice FROM payments.bank_notices WHERE source = 'manual' AND reference = p_reference;
    IF v_notice.amount_crc <> p_amount_crc OR v_notice.raw_sha256 <> p_raw_sha256 THEN
      RAISE EXCEPTION 'bank notice manual/% was already recorded with different content', p_reference
        USING ERRCODE = 'unique_violation';
    END IF;
    RETURN v_notice.id;
  END IF;
  INSERT INTO payments.manual_entries (notice_id, entered_by, paid_at)
  VALUES (v_id, app.actor_id(), p_paid_at);
  RETURN v_id;
END
$$;

-- Matches a notice to its order and confirms it, as the system. p_pay_codes are the
-- well-formed payment codes the Worker found in the description (findPayCodes in
-- @passripple/crypto). In order:
--   1. one order with one of those codes: that order (two orders: ambiguous, for a person);
--   2. no code: the one pending order holding the notice's amount, created before the
--      payment;
--   3. nothing: unmatched, for the administrator's tray.
-- Confirming is payments.confirm, so running this again on the same notice changes nothing.
CREATE FUNCTION payments.reconcile(p_notice_id uuid, p_pay_codes text[])
RETURNS TABLE (result text, order_id uuid, order_code text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
#variable_conflict use_column
DECLARE
  v_notice   payments.bank_notices;
  v_paid_at  timestamptz;
  v_orders   uuid[];
  v_order_id uuid;
BEGIN
  IF app.actor_role() IS DISTINCT FROM 'system' THEN
    RAISE EXCEPTION 'only the system reconciles payments' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO v_notice FROM payments.bank_notices n WHERE n.id = p_notice_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bank notice % not found', p_notice_id USING ERRCODE = 'no_data_found';
  END IF;
  IF v_notice.status IN ('applied', 'surplus') THEN
    SELECT p.order_id INTO v_order_id FROM payments.payments p WHERE p.notice_id = p_notice_id;
    RETURN QUERY SELECT CASE v_notice.status WHEN 'applied' THEN 'already_confirmed' ELSE 'surplus' END,
                        v_order_id, (SELECT o.pay_code FROM orders.orders o WHERE o.id = v_order_id);
    RETURN;
  END IF;

  IF coalesce(cardinality(p_pay_codes), 0) > 0 THEN
    v_orders := ARRAY(SELECT o.id FROM orders.orders o WHERE o.pay_code = ANY (p_pay_codes[1:10]));
    IF cardinality(v_orders) > 1 THEN
      UPDATE payments.bank_notices n SET status = 'unmatched' WHERE n.id = p_notice_id AND n.status = 'received';
      RETURN QUERY SELECT 'ambiguous'::text, NULL::uuid, NULL::text;
      RETURN;
    END IF;
    v_order_id := v_orders[1];
  END IF;

  IF v_order_id IS NULL THEN
    SELECT coalesce(m.paid_at, v_notice.received_at) INTO v_paid_at
      FROM (SELECT 1) AS one LEFT JOIN payments.manual_entries m ON m.notice_id = p_notice_id;
    -- Only an order holding the amount as its own reservation: never one of several equals.
    SELECT o.id INTO v_order_id
      FROM orders.pending_amounts a JOIN orders.orders o ON o.id = a.order_id
     WHERE a.amount_crc = v_notice.amount_crc AND o.status = 'pending'
       AND o.created_at <= v_paid_at + interval '5 minutes';
  END IF;

  IF v_order_id IS NULL THEN
    UPDATE payments.bank_notices n SET status = 'unmatched' WHERE n.id = p_notice_id AND n.status = 'received';
    RETURN QUERY SELECT 'unmatched'::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;
  RETURN QUERY SELECT payments.confirm(p_notice_id, v_order_id), v_order_id,
                      (SELECT o.pay_code FROM orders.orders o WHERE o.id = v_order_id);
END
$$;

GRANT EXECUTE ON FUNCTION payments.record_manual_notice(text, integer, text, text, text, timestamptz, bytea)
  TO passripple_api;
GRANT EXECUTE ON FUNCTION payments.reconcile(uuid, text[]) TO passripple_api;
