-- An order whose total is ₡0 (a free ticket type with no service charge) has nothing to
-- pay, so it would wait for a bank notice that never comes and expire. The checkout settles
-- it right after placing it: the order becomes paid in the same transaction, converts its
-- hold and emits order.paid, and its tickets are issued like any other (ADR 0029). An order
-- with a positive total is never settled here: only a payment confirms it (I4).

CREATE FUNCTION orders.settle_free(p_order_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_amount integer;
BEGIN
  IF NOT coalesce(app.actor_role() IN ('buyer', 'system'), false) THEN
    RAISE EXCEPTION 'this actor cannot settle orders' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT o.amount_crc INTO v_amount FROM orders.orders o WHERE o.id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order % not found', p_order_id USING ERRCODE = 'no_data_found';
  END IF;
  IF v_amount <> 0 THEN
    RAISE EXCEPTION 'order % has an amount to pay', p_order_id
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  RETURN orders.mark_paid(p_order_id);
END
$$;

GRANT EXECUTE ON FUNCTION orders.settle_free(uuid) TO passripple_api;
