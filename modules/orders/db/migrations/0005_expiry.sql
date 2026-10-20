-- Expiry of pending orders (design 9.3, step 4 of Phase 3). Same as 0002, and every order
-- it expires emits order.expired through the outbox (ADR 0029). Its unique amount is freed
-- by the trigger of 0004 when the status leaves pending. Two runs at the same time skip each
-- other's rows (SKIP LOCKED), and a payment confirmed at the same instant either locks the
-- order first (and the order is paid) or finds it expired (and it is owed back).
CREATE OR REPLACE FUNCTION orders.expire_orders(p_now timestamptz DEFAULT now())
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_order orders.orders;
  v_count integer := 0;
BEGIN
  IF app.actor_role() IS DISTINCT FROM 'system' THEN
    RAISE EXCEPTION 'only the system expires orders' USING ERRCODE = 'insufficient_privilege';
  END IF;
  FOR v_order IN
    SELECT * FROM orders.orders
     WHERE status = 'pending' AND expires_at <= p_now
       FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE orders.orders SET status = 'expired' WHERE id = v_order.id;
    PERFORM inventory.release_hold(v_order.hold_id);
    PERFORM orders.emit(jsonb_build_object(
      'type', 'order.expired', 'orderId', v_order.id, 'eventId', v_order.event_id,
      'occurredAt', to_jsonb(now())));
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END
$$;
