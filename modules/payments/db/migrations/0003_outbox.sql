-- Domain events emitted by payments (ADR 0029), through this module's own outbox, written in
-- the same transaction as the change. Same shape and rules as orders' outbox.

CREATE TABLE payments.outbox (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  seq          bigint      GENERATED ALWAYS AS IDENTITY UNIQUE,
  type         text        NOT NULL CHECK (type ~ '^[a-z]+\.[a-z_]+$'),
  payload      jsonb       NOT NULL CHECK (jsonb_typeof(payload) = 'object' AND payload ->> 'type' = type),
  created_at   timestamptz NOT NULL DEFAULT clock_timestamp(),
  published_at timestamptz
);
CREATE INDEX outbox_unpublished_idx ON payments.outbox (seq) WHERE published_at IS NULL;

CREATE FUNCTION payments.guard_outbox_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF (NEW.id, NEW.seq, NEW.type, NEW.payload, NEW.created_at)
     IS DISTINCT FROM (OLD.id, OLD.seq, OLD.type, OLD.payload, OLD.created_at)
     OR OLD.published_at IS NOT NULL THEN
    RAISE EXCEPTION 'outbox row %: only an unpublished row can be marked published', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER outbox_guard_update BEFORE UPDATE ON payments.outbox
  FOR EACH ROW EXECUTE FUNCTION payments.guard_outbox_update();
CREATE TRIGGER outbox_no_delete BEFORE DELETE ON payments.outbox
  FOR EACH ROW EXECUTE FUNCTION app.reject_mutation();
CREATE TRIGGER outbox_no_truncate BEFORE TRUNCATE ON payments.outbox
  FOR EACH STATEMENT EXECUTE FUNCTION app.reject_mutation();

ALTER TABLE payments.outbox ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
CREATE POLICY outbox_module_read ON payments.outbox FOR SELECT USING (app.is_module_role());
CREATE POLICY outbox_module_write ON payments.outbox TO passripple_owner_payments
  USING (true) WITH CHECK (true);

CREATE FUNCTION payments.emit(p_payload jsonb)
RETURNS void
LANGUAGE sql
SET search_path = pg_catalog
AS $$
  INSERT INTO payments.outbox (type, payload) VALUES (p_payload ->> 'type', p_payload);
$$;

CREATE FUNCTION payments.outbox_claim(p_limit integer)
RETURNS TABLE (id uuid, type text, payload jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF app.actor_role() IS DISTINCT FROM 'system' THEN
    RAISE EXCEPTION 'only the system relays domain events' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
    SELECT o.id, o.type, o.payload FROM payments.outbox o
     WHERE o.published_at IS NULL
     ORDER BY o.seq
     LIMIT least(greatest(coalesce(p_limit, 1), 1), 100)
       FOR UPDATE SKIP LOCKED;
END
$$;

CREATE FUNCTION payments.outbox_mark_published(p_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_count integer;
BEGIN
  IF app.actor_role() IS DISTINCT FROM 'system' THEN
    RAISE EXCEPTION 'only the system relays domain events' USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE payments.outbox SET published_at = now()
   WHERE id = ANY (p_ids) AND published_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END
$$;

-- ── payment.succeeded ────────────────────────────────────────────────────────
-- Same as 0002, and a notice that becomes the payment of an order paid in time emits
-- payment.succeeded. The order itself emits order.paid (orders.mark_paid).
CREATE OR REPLACE FUNCTION payments.confirm(p_notice_id uuid, p_order_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_notice     payments.bank_notices;
  v_amount     integer;
  v_event_id   uuid;
  v_payment_id uuid;
BEGIN
  IF app.actor_role() IS DISTINCT FROM 'system' THEN
    RAISE EXCEPTION 'only the system confirms payments' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_notice FROM payments.bank_notices WHERE id = p_notice_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bank notice % not found', p_notice_id USING ERRCODE = 'no_data_found';
  END IF;
  IF v_notice.status = 'applied' THEN
    RETURN 'already_confirmed';
  END IF;
  IF v_notice.status = 'surplus' THEN
    RETURN 'surplus';
  END IF;

  SELECT o.amount_crc, o.event_id INTO v_amount, v_event_id FROM orders.orders o WHERE o.id = p_order_id;
  IF NOT FOUND THEN
    UPDATE payments.bank_notices SET status = 'unmatched' WHERE id = p_notice_id AND status = 'received';
    RETURN 'unmatched';
  END IF;
  IF v_amount <> v_notice.amount_crc THEN
    UPDATE payments.bank_notices SET status = 'unmatched' WHERE id = p_notice_id AND status = 'received';
    RETURN 'amount_mismatch';
  END IF;

  -- The UNIQUE constraints decide races: two notices for one order, or one notice twice.
  INSERT INTO payments.payments (order_id, notice_id, amount_crc)
  VALUES (p_order_id, p_notice_id, v_notice.amount_crc)
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_payment_id;
  IF v_payment_id IS NULL THEN
    IF EXISTS (SELECT 1 FROM payments.payments WHERE notice_id = p_notice_id) THEN
      RETURN 'already_confirmed';
    END IF;
    UPDATE payments.bank_notices SET status = 'surplus' WHERE id = p_notice_id;
    RETURN 'surplus';
  END IF;

  UPDATE payments.bank_notices SET status = 'applied' WHERE id = p_notice_id;
  IF orders.mark_paid(p_order_id) = 'refund_due' THEN
    RETURN 'refund_due';
  END IF;
  PERFORM payments.emit(jsonb_build_object(
    'type', 'payment.succeeded', 'paymentId', v_payment_id, 'orderId', p_order_id,
    'eventId', v_event_id, 'amountCrc', v_notice.amount_crc, 'occurredAt', to_jsonb(now())));
  RETURN 'paid';
END
$$;

GRANT EXECUTE ON FUNCTION payments.outbox_claim(integer) TO passripple_api;
GRANT EXECUTE ON FUNCTION payments.outbox_mark_published(uuid[]) TO passripple_api;
