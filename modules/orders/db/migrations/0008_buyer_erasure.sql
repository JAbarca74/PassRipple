-- Erasure of a buyer's data (design 14.7, ADR 0037). orders holds everything personal about a
-- buyer: the email or phone, the access tokens and the contact codes. Erasing them leaves the
-- order itself, with its amounts and lines, so sales stay accountable (tax and municipal
-- duties, 14.7) and the ledger is untouched (I9). Consents keep their proof: their subject is
-- the order, never contact data. The payer's name and phone from the bank's notice stay with
-- the payment record (14.8).
--
-- Until now an order needed a contact and its token, and neither could change (Anexo D). An
-- erased order is the one exception: once, both contacts and the token become NULL together
-- and erased_at is set.

ALTER TABLE orders.orders ADD COLUMN erased_at timestamptz;
ALTER TABLE orders.orders ALTER COLUMN access_token_hash DROP NOT NULL;

DO $$
DECLARE
  v_name text;
BEGIN
  SELECT c.conname INTO v_name FROM pg_constraint c
   WHERE c.conrelid = 'orders.orders'::regclass AND c.contype = 'c'
     AND pg_get_constraintdef(c.oid) ~ 'contact_email IS NOT NULL\) OR \(contact_phone IS NOT NULL';
  EXECUTE format('ALTER TABLE orders.orders DROP CONSTRAINT %I', v_name);
END
$$;

ALTER TABLE orders.orders
  ADD CONSTRAINT orders_contact_or_erased
    CHECK (contact_email IS NOT NULL OR contact_phone IS NOT NULL OR erased_at IS NOT NULL),
  ADD CONSTRAINT orders_token_or_erased
    CHECK (access_token_hash IS NOT NULL OR erased_at IS NOT NULL),
  ADD CONSTRAINT orders_erased_has_no_contact
    CHECK (erased_at IS NULL
           OR (contact_email IS NULL AND contact_phone IS NULL AND access_token_hash IS NULL));

-- Same rules as 0002, plus the one-way erasure.
CREATE OR REPLACE FUNCTION orders.guard_order_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
  v_erasing boolean := OLD.erased_at IS NULL AND NEW.erased_at IS NOT NULL;
BEGIN
  IF OLD.erased_at IS NOT NULL AND NEW.erased_at IS DISTINCT FROM OLD.erased_at THEN
    RAISE EXCEPTION 'order %: an erasure is final', OLD.id USING ERRCODE = 'restrict_violation';
  END IF;
  IF (NEW.id, NEW.event_id, NEW.hold_id, NEW.pay_code, NEW.amount_crc, NEW.idem_key,
      NEW.expires_at, NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.event_id, OLD.hold_id, OLD.pay_code, OLD.amount_crc, OLD.idem_key,
      OLD.expires_at, OLD.created_at)
     OR (NOT v_erasing AND (NEW.contact_email, NEW.contact_phone, NEW.access_token_hash)
                           IS DISTINCT FROM (OLD.contact_email, OLD.contact_phone, OLD.access_token_hash)) THEN
    RAISE EXCEPTION 'order %: only its status can change', OLD.id USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status
     AND (OLD.status, NEW.status) NOT IN (('pending', 'paid'), ('pending', 'expired'),
                                          ('pending', 'refund_due'), ('expired', 'refund_due'),
                                          ('paid', 'refund_due'), ('refund_due', 'refunded')) THEN
    RAISE EXCEPTION 'order %: % cannot become %', OLD.id, OLD.status, NEW.status
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.paid_at IS NOT NULL AND NEW.paid_at IS DISTINCT FROM OLD.paid_at THEN
    RAISE EXCEPTION 'order %: the payment time cannot change', OLD.id USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;

-- What keeps an address from being erased now: an order still pending, or a paid order
-- for an event that has not ended. The buyer must not lose a paid ticket without knowing
-- (14.7): the page shows these, and the buyer can come back after the event.
CREATE FUNCTION orders.erasure_blockers(p_code_id uuid)
RETURNS TABLE (pay_code text, status text, event_name text, ends_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
#variable_conflict use_column
BEGIN
  IF app.actor_role() IS DISTINCT FROM 'system' THEN
    RAISE EXCEPTION 'only the system erases buyers' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
    SELECT o.pay_code, o.status, e.name, e.ends_at
      FROM orders.contact_codes c
      JOIN orders.orders o ON o.contact_email = c.contact_email
      JOIN events.events e ON e.id = o.event_id
     WHERE c.id = p_code_id AND c.purpose = 'erasure'
       AND (o.status = 'pending' OR (o.status = 'paid' AND e.ends_at > now()))
     ORDER BY e.ends_at;
END
$$;

-- Erases everything personal of the address behind a used erasure code: contacts and tokens
-- of its orders, their recovery tokens, and its contact codes. Returns how many orders were
-- erased. Refuses while erasure_blockers has rows.
CREATE FUNCTION orders.erase_buyer(p_code_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_email text;
  v_count integer;
BEGIN
  IF app.actor_role() IS DISTINCT FROM 'system' THEN
    RAISE EXCEPTION 'only the system erases buyers' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT c.contact_email INTO v_email FROM orders.contact_codes c
   WHERE c.id = p_code_id AND c.purpose = 'erasure' AND c.used_at > now() - interval '5 minutes';
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'no erasure code was just used' USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- Serializes with a checkout for the same address placed at this moment.
  PERFORM pg_advisory_xact_lock(hashtextextended('orders.contact_codes/' || v_email, 0));
  IF EXISTS (SELECT 1 FROM orders.erasure_blockers(p_code_id)) THEN
    RAISE EXCEPTION 'the address has open orders or tickets for events to come'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  DELETE FROM orders.order_tokens t
   USING orders.orders o WHERE o.id = t.order_id AND o.contact_email = v_email;
  UPDATE orders.orders
     SET contact_email = NULL, contact_phone = NULL, access_token_hash = NULL, erased_at = now()
   WHERE contact_email = v_email;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  DELETE FROM orders.contact_codes WHERE contact_email = v_email;
  RETURN v_count;
END
$$;

GRANT EXECUTE ON FUNCTION orders.erasure_blockers(uuid) TO passripple_api;
GRANT EXECUTE ON FUNCTION orders.erase_buyer(uuid) TO passripple_api;
