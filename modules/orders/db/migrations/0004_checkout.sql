-- Checkout (design 10.1 to 10.3, ADR 0031 and 0033): the order gets an amount that no other
-- pending order has, so a notice without the order's code can still be matched by its
-- amount, and a payment code chosen from candidates the API draws.

-- ── Unique amounts (ADR 0031) ────────────────────────────────────────────────
-- One row per amount in use by a pending order, platform-wide: a bank notice does not say
-- which event it pays. The primary key decides concurrent checkouts.
CREATE TABLE orders.pending_amounts (
  amount_crc integer     PRIMARY KEY CHECK (amount_crc > 0),
  order_id   uuid        NOT NULL UNIQUE
             REFERENCES orders.orders (id) DEFERRABLE INITIALLY DEFERRED,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE orders.pending_amounts ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
CREATE POLICY pending_amounts_module_read ON orders.pending_amounts FOR SELECT
  USING (app.is_module_role());
CREATE POLICY pending_amounts_module_write ON orders.pending_amounts TO passripple_owner_orders
  USING (true) WITH CHECK (true);

-- An order that leaves pending, by payment, expiry or a late payment, frees its amount.
CREATE FUNCTION orders.release_amount()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  DELETE FROM orders.pending_amounts WHERE order_id = NEW.id;
  RETURN NULL;
END
$$;

CREATE TRIGGER orders_release_amount AFTER UPDATE OF status ON orders.orders
  FOR EACH ROW WHEN (OLD.status = 'pending' AND NEW.status <> 'pending')
  EXECUTE FUNCTION orders.release_amount();

-- ── Placing an order ─────────────────────────────────────────────────────────
-- The checkout's order for an active hold. Like orders.create, it freezes the price, read
-- from the catalog now, and the fee the API calculated with the pricing package (I5). On top:
--   - the amount is the base total plus the smallest offset, from 0 to p_max_offset_crc,
--     that no other pending order uses; when none is free the order keeps the base amount
--     without a reservation, and can be matched only by its code (ADR 0031);
--   - the payment code is the first of the candidates not taken (ADR 0033);
--   - the same idempotency key returns the order it created before. A concurrent request
--     with the same key that loses the race releases its own hold and returns the winner's.
CREATE FUNCTION orders.place(
  p_hold_id uuid,
  p_idem_key text,
  p_contact_email text,
  p_contact_phone text,
  p_access_token text,
  p_pay_codes text[],
  p_unit_fee_crc integer,
  p_unit_fee_tax_crc integer,
  p_fee_rule text,
  p_max_offset_crc integer
) RETURNS TABLE (order_id uuid, pay_code text, amount_crc integer, amount_unique boolean,
                 expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
#variable_conflict use_column
DECLARE
  v_existing   orders.orders;
  v_hold       inventory.holds;
  v_price      integer;
  v_base       integer;
  v_amount     integer;
  v_unique     boolean := false;
  v_order_id   uuid := gen_random_uuid();
  v_code       text;
  v_placed     boolean := false;
  v_constraint text;
BEGIN
  IF NOT coalesce(app.actor_role() IN ('buyer', 'system'), false) THEN
    RAISE EXCEPTION 'this actor cannot create orders' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_existing FROM orders.orders o WHERE o.idem_key = p_idem_key;
  IF FOUND THEN
    IF v_existing.hold_id <> p_hold_id THEN
      PERFORM inventory.release_hold(p_hold_id);
    END IF;
    RETURN QUERY SELECT v_existing.id, v_existing.pay_code, v_existing.amount_crc,
                        EXISTS (SELECT 1 FROM orders.pending_amounts a WHERE a.order_id = v_existing.id),
                        v_existing.expires_at;
    RETURN;
  END IF;

  IF p_access_token IS NULL OR length(p_access_token) < 32 THEN
    RAISE EXCEPTION 'the access token must have at least 32 characters' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF coalesce(cardinality(p_pay_codes), 0) NOT BETWEEN 1 AND 10 THEN
    RAISE EXCEPTION 'between 1 and 10 payment code candidates' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_max_offset_crc IS NULL OR p_max_offset_crc NOT BETWEEN 0 AND 1000 THEN
    RAISE EXCEPTION 'the amount offset is between 0 and 1000' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT * INTO v_hold FROM inventory.holds h WHERE h.id = p_hold_id;
  IF NOT FOUND OR v_hold.ended_at IS NOT NULL OR v_hold.expires_at <= now() THEN
    RAISE EXCEPTION 'hold % is not active', p_hold_id USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  SELECT t.price_crc INTO v_price FROM catalog.ticket_types t WHERE t.id = v_hold.ticket_type_id;
  v_base := v_hold.quantity * (v_price + p_unit_fee_crc + p_unit_fee_tax_crc);
  v_amount := v_base;

  -- The reservation refers to the order inserted below; the foreign key is checked at commit.
  IF v_base > 0 THEN
    FOR v_offset IN 0 .. p_max_offset_crc LOOP
      INSERT INTO orders.pending_amounts (amount_crc, order_id)
      VALUES (v_base + v_offset, v_order_id)
      ON CONFLICT (amount_crc) DO NOTHING;
      IF FOUND THEN
        v_amount := v_base + v_offset;
        v_unique := true;
        EXIT;
      END IF;
    END LOOP;
  END IF;

  FOREACH v_code IN ARRAY p_pay_codes LOOP
    BEGIN
      INSERT INTO orders.orders (id, event_id, hold_id, contact_email, contact_phone,
                                 access_token_hash, pay_code, amount_crc, idem_key, expires_at)
      VALUES (v_order_id, v_hold.event_id, p_hold_id, p_contact_email, p_contact_phone,
              sha256(convert_to(p_access_token, 'UTF8')), v_code, v_amount, p_idem_key,
              v_hold.expires_at);
      v_placed := true;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
      IF v_constraint = 'orders_pay_code_key' THEN
        CONTINUE;
      ELSIF v_constraint = 'orders_idem_key_key' THEN
        -- A concurrent request with the same key won the race.
        DELETE FROM orders.pending_amounts a WHERE a.order_id = v_order_id;
        PERFORM inventory.release_hold(p_hold_id);
        SELECT * INTO v_existing FROM orders.orders o WHERE o.idem_key = p_idem_key;
        RETURN QUERY SELECT v_existing.id, v_existing.pay_code, v_existing.amount_crc,
                            EXISTS (SELECT 1 FROM orders.pending_amounts a WHERE a.order_id = v_existing.id),
                            v_existing.expires_at;
        RETURN;
      END IF;
      RAISE;
    END;
  END LOOP;
  IF NOT v_placed THEN
    RAISE EXCEPTION 'every payment code candidate is taken' USING ERRCODE = 'unique_violation';
  END IF;

  INSERT INTO orders.order_items (order_id, ticket_type_id, quantity, unit_price_crc,
                                  unit_fee_crc, unit_fee_tax_crc, fee_rule)
  VALUES (v_order_id, v_hold.ticket_type_id, v_hold.quantity, v_price,
          p_unit_fee_crc, p_unit_fee_tax_crc, p_fee_rule);

  RETURN QUERY SELECT v_order_id, v_code, v_amount, v_unique, v_hold.expires_at;
END
$$;

-- A checkout retried with the same idempotency key, before it holds anything: the order
-- that key created, if any. The key is as secret as the access token it derives (ADR 0033).
CREATE FUNCTION orders.order_by_idem_key(p_idem_key text)
RETURNS TABLE (order_id uuid, status text, pay_code text, amount_crc integer,
               amount_unique boolean, expires_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
#variable_conflict use_column
BEGIN
  IF NOT coalesce(app.actor_role() IN ('buyer', 'system'), false) THEN
    RAISE EXCEPTION 'this actor cannot read orders by key' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
    SELECT o.id, o.status, o.pay_code, o.amount_crc,
           EXISTS (SELECT 1 FROM orders.pending_amounts a WHERE a.order_id = o.id), o.expires_at
      FROM orders.orders o WHERE o.idem_key = p_idem_key;
END
$$;

GRANT EXECUTE ON FUNCTION orders.place(uuid, text, text, text, text, text[], integer, integer, text, integer)
  TO passripple_api;
GRANT EXECUTE ON FUNCTION orders.order_by_idem_key(text) TO passripple_api;
