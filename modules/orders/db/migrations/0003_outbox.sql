-- Domain events emitted by orders (ADR 0029). Each event is written to this module's own
-- outbox in the same transaction as the change it describes, so it exists if and only if
-- the change committed. A relay in workers/jobs publishes the rows to Cloudflare Queues and
-- marks them published. Delivery is at least once: consumers are idempotent by row id.

CREATE TABLE orders.outbox (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Publishing order: the order in which the rows were written.
  seq          bigint      GENERATED ALWAYS AS IDENTITY UNIQUE,
  type         text        NOT NULL CHECK (type ~ '^[a-z]+\.[a-z_]+$'),
  -- The event as @passripple/contracts defines it (camelCase, ISO 8601 times).
  payload      jsonb       NOT NULL CHECK (jsonb_typeof(payload) = 'object' AND payload ->> 'type' = type),
  created_at   timestamptz NOT NULL DEFAULT clock_timestamp(),
  published_at timestamptz
);
CREATE INDEX outbox_unpublished_idx ON orders.outbox (seq) WHERE published_at IS NULL;

-- A row is never deleted, and only its publishing time is set, once.
CREATE FUNCTION orders.guard_outbox_update()
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

CREATE TRIGGER outbox_guard_update BEFORE UPDATE ON orders.outbox
  FOR EACH ROW EXECUTE FUNCTION orders.guard_outbox_update();
CREATE TRIGGER outbox_no_delete BEFORE DELETE ON orders.outbox
  FOR EACH ROW EXECUTE FUNCTION app.reject_mutation();
CREATE TRIGGER outbox_no_truncate BEFORE TRUNCATE ON orders.outbox
  FOR EACH STATEMENT EXECUTE FUNCTION app.reject_mutation();

ALTER TABLE orders.outbox ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
CREATE POLICY outbox_module_read ON orders.outbox FOR SELECT USING (app.is_module_role());
CREATE POLICY outbox_module_write ON orders.outbox TO passripple_owner_orders
  USING (true) WITH CHECK (true);

-- Writes an event to the outbox. Internal: only this module's functions call it.
CREATE FUNCTION orders.emit(p_payload jsonb)
RETURNS void
LANGUAGE sql
SET search_path = pg_catalog
AS $$
  INSERT INTO orders.outbox (type, payload) VALUES (p_payload ->> 'type', p_payload);
$$;

-- The relay: unpublished rows in the order they were written, locked so that a relay
-- running at the same time skips them.
CREATE FUNCTION orders.outbox_claim(p_limit integer)
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
    SELECT o.id, o.type, o.payload FROM orders.outbox o
     WHERE o.published_at IS NULL
     ORDER BY o.seq
     LIMIT least(greatest(coalesce(p_limit, 1), 1), 100)
       FOR UPDATE SKIP LOCKED;
END
$$;

-- The relay, after the queue accepted the rows. Returns how many were marked.
CREATE FUNCTION orders.outbox_mark_published(p_ids uuid[])
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
  UPDATE orders.outbox SET published_at = now()
   WHERE id = ANY (p_ids) AND published_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END
$$;

-- ── order.paid ───────────────────────────────────────────────────────────────
-- Same as 0002, and the order emits order.paid when it becomes paid. A payment that arrives
-- too late (refund_due) emits nothing: there are no tickets to issue.
CREATE OR REPLACE FUNCTION orders.mark_paid(p_order_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_order orders.orders;
BEGIN
  SELECT * INTO v_order FROM orders.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order % not found', p_order_id USING ERRCODE = 'no_data_found';
  END IF;
  IF v_order.status = 'paid' THEN
    RETURN 'already_paid';
  END IF;
  IF v_order.status = 'pending' AND inventory.convert_hold(v_order.hold_id) THEN
    UPDATE orders.orders SET status = 'paid', paid_at = now() WHERE id = p_order_id;
    PERFORM orders.emit(jsonb_build_object(
      'type', 'order.paid', 'orderId', p_order_id, 'eventId', v_order.event_id,
      'occurredAt', to_jsonb(now())));
    RETURN 'paid';
  END IF;
  IF v_order.status IN ('pending', 'expired') THEN
    UPDATE orders.orders SET status = 'refund_due' WHERE id = p_order_id;
  END IF;
  RETURN 'refund_due';
END
$$;

-- The consumer of order.paid: what to issue for a paid order. Ticketing cannot read this
-- module (rule R2), so workers/jobs reads it here and passes it on (ADR 0029). Empty for
-- an order that is not paid, so a late or replayed event issues nothing.
CREATE FUNCTION orders.paid_order_lines(p_order_id uuid)
RETURNS TABLE (event_id uuid, ticket_type_id uuid, quantity integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF app.actor_role() IS DISTINCT FROM 'system' THEN
    RAISE EXCEPTION 'only the system reads paid orders' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
    SELECT o.event_id, i.ticket_type_id, i.quantity
      FROM orders.orders o JOIN orders.order_items i ON i.order_id = o.id
     WHERE o.id = p_order_id AND o.status = 'paid'
     ORDER BY i.created_at, i.id;
END
$$;

GRANT EXECUTE ON FUNCTION orders.outbox_claim(integer) TO passripple_api;
GRANT EXECUTE ON FUNCTION orders.outbox_mark_published(uuid[]) TO passripple_api;
GRANT EXECUTE ON FUNCTION orders.paid_order_lines(uuid) TO passripple_api;
