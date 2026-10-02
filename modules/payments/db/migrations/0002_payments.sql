-- Invariant I4: no payment is processed twice. A bank notice is recorded once per source
-- and reference, it becomes at most one payment, and an order has at most one payment.
-- This module confirms payments; it does not issue tickets or move money.

CREATE TABLE payments.bank_notices (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Configured identifier of the channel the notice arrived through (a parser), never a
  -- bank's name.
  source      text        NOT NULL CHECK (source ~ '^[a-z][a-z0-9_]*$'),
  -- The bank's reference for the transfer.
  reference   text        NOT NULL CHECK (btrim(reference) <> '' AND length(reference) <= 64),
  amount_crc  integer     NOT NULL CHECK (amount_crc > 0),
  -- Written by the payer: untrusted text, stored but never interpreted here.
  description text        CHECK (length(description) <= 500),
  payer_name  text,
  payer_phone text,
  -- SHA-256 of the raw notice, kept as evidence.
  raw_sha256  bytea       NOT NULL CHECK (length(raw_sha256) = 32),
  received_at timestamptz NOT NULL DEFAULT now(),
  -- received: not yet matched; applied: became a payment; unmatched: no order or a
  -- different amount; surplus: its order was already paid, so the money is owed back.
  status      text        NOT NULL DEFAULT 'received'
              CHECK (status IN ('received', 'applied', 'unmatched', 'surplus')),
  -- I4: the same notice arriving again is the same row.
  CONSTRAINT bank_notices_once UNIQUE (source, reference)
);

CREATE TABLE payments.payments (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- I4: one payment per order and one per notice.
  order_id     uuid        NOT NULL UNIQUE REFERENCES orders.orders (id),
  notice_id    uuid        NOT NULL UNIQUE REFERENCES payments.bank_notices (id),
  amount_crc   integer     NOT NULL CHECK (amount_crc > 0),
  confirmed_at timestamptz NOT NULL DEFAULT now()
);

-- A confirmed payment is final: no role, the owner included, changes or removes it.
CREATE TRIGGER payments_append_only BEFORE UPDATE OR DELETE ON payments.payments
  FOR EACH ROW EXECUTE FUNCTION app.reject_mutation();
CREATE TRIGGER payments_no_truncate BEFORE TRUNCATE ON payments.payments
  FOR EACH STATEMENT EXECUTE FUNCTION app.reject_mutation();

-- A notice is never deleted, and only its status moves:
--   received → applied | unmatched | surplus      unmatched → applied | surplus
CREATE FUNCTION payments.guard_notice_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF (NEW.id, NEW.source, NEW.reference, NEW.amount_crc, NEW.description, NEW.payer_name,
      NEW.payer_phone, NEW.raw_sha256, NEW.received_at)
     IS DISTINCT FROM
     (OLD.id, OLD.source, OLD.reference, OLD.amount_crc, OLD.description, OLD.payer_name,
      OLD.payer_phone, OLD.raw_sha256, OLD.received_at) THEN
    RAISE EXCEPTION 'bank notice %: only its status can change', OLD.id USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status
     AND (OLD.status, NEW.status) NOT IN (('received', 'applied'), ('received', 'unmatched'),
                                          ('received', 'surplus'), ('unmatched', 'applied'),
                                          ('unmatched', 'surplus')) THEN
    RAISE EXCEPTION 'bank notice %: % cannot become %', OLD.id, OLD.status, NEW.status
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER bank_notices_guard_update BEFORE UPDATE ON payments.bank_notices
  FOR EACH ROW EXECUTE FUNCTION payments.guard_notice_update();
CREATE TRIGGER bank_notices_no_delete BEFORE DELETE ON payments.bank_notices
  FOR EACH ROW EXECUTE FUNCTION app.reject_mutation();
CREATE TRIGGER bank_notices_no_truncate BEFORE TRUNCATE ON payments.bank_notices
  FOR EACH STATEMENT EXECUTE FUNCTION app.reject_mutation();

-- ── Row Level Security ───────────────────────────────────────────────────────
-- The API never writes these tables. Notices hold the payer's data: only administrators
-- read them. Organizers see the payments of their organization's events.
ALTER TABLE payments.bank_notices ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
ALTER TABLE payments.payments     ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;

CREATE POLICY bank_notices_module_read ON payments.bank_notices FOR SELECT USING (app.is_module_role());
CREATE POLICY bank_notices_module_write ON payments.bank_notices TO passripple_owner_payments
  USING (true) WITH CHECK (true);
CREATE POLICY payments_module_read ON payments.payments FOR SELECT USING (app.is_module_role());
CREATE POLICY payments_module_write ON payments.payments TO passripple_owner_payments
  USING (true) WITH CHECK (true);

CREATE POLICY bank_notices_api_read ON payments.bank_notices FOR SELECT TO passripple_api
  USING ((SELECT app.actor_role()) = 'admin');
-- Reads through orders, whose own policy limits organizers to their events.
CREATE POLICY payments_api_read ON payments.payments FOR SELECT TO passripple_api
  USING ((SELECT app.actor_role()) = 'admin'
         OR EXISTS (SELECT 1 FROM orders.orders o WHERE o.id = payments.order_id));

GRANT USAGE ON SCHEMA payments TO passripple_api;
GRANT SELECT ON payments.bank_notices, payments.payments TO passripple_api;

-- ── Functions ────────────────────────────────────────────────────────────────
-- Records a parsed bank notice. The same notice arriving again returns the same id; the
-- same reference with a different amount or content is an error to investigate, never a
-- second notice.
CREATE FUNCTION payments.record_notice(
  p_source text,
  p_reference text,
  p_amount_crc integer,
  p_description text,
  p_payer_name text,
  p_payer_phone text,
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
  IF app.actor_role() IS DISTINCT FROM 'system' THEN
    RAISE EXCEPTION 'only the system records bank notices' USING ERRCODE = 'insufficient_privilege';
  END IF;
  INSERT INTO payments.bank_notices (source, reference, amount_crc, description, payer_name,
                                     payer_phone, raw_sha256)
  VALUES (p_source, p_reference, p_amount_crc, p_description, p_payer_name, p_payer_phone, p_raw_sha256)
  ON CONFLICT (source, reference) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  SELECT * INTO v_notice FROM payments.bank_notices WHERE source = p_source AND reference = p_reference;
  IF v_notice.amount_crc <> p_amount_crc OR v_notice.raw_sha256 <> p_raw_sha256 THEN
    RAISE EXCEPTION 'bank notice %/% was already recorded with different content', p_source, p_reference
      USING ERRCODE = 'unique_violation';
  END IF;
  RETURN v_notice.id;
END
$$;

-- Turns a notice into the payment of an order. Idempotent: confirming the same notice
-- again returns already_confirmed. Returns:
--   paid               the order is now paid (the API emits payment.succeeded)
--   refund_due         the money arrived after the order expired: owed back
--   already_confirmed  this notice was already a payment
--   surplus            the order was already paid by another notice: owed back
--   amount_mismatch    the notice's amount is not the order's
--   unmatched          no such order
CREATE FUNCTION payments.confirm(p_notice_id uuid, p_order_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_notice     payments.bank_notices;
  v_amount     integer;
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

  SELECT o.amount_crc INTO v_amount FROM orders.orders o WHERE o.id = p_order_id;
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
  RETURN CASE orders.mark_paid(p_order_id) WHEN 'refund_due' THEN 'refund_due' ELSE 'paid' END;
END
$$;

GRANT EXECUTE ON FUNCTION payments.record_notice(text, text, integer, text, text, text, bytea)
  TO passripple_api;
GRANT EXECUTE ON FUNCTION payments.confirm(uuid, uuid) TO passripple_api;
