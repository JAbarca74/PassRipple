-- Issuing an order's tickets when the order is paid (ADR 0029). ticketing receives
-- order.paid from the queue; workers/jobs reads the order's lines from orders, which this
-- module cannot read (rule R2), and passes them here. The handler is idempotent by the
-- event's id, recorded in this module's inbox, and by the order: an order's tickets are
-- issued once, whatever arrives twice or out of order.
--
-- The module also gets its own outbox, for ticket.issued.

CREATE TABLE ticketing.outbox (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  seq          bigint      GENERATED ALWAYS AS IDENTITY UNIQUE,
  type         text        NOT NULL CHECK (type ~ '^[a-z]+\.[a-z_]+$'),
  payload      jsonb       NOT NULL CHECK (jsonb_typeof(payload) = 'object' AND payload ->> 'type' = type),
  created_at   timestamptz NOT NULL DEFAULT clock_timestamp(),
  published_at timestamptz
);
CREATE INDEX outbox_unpublished_idx ON ticketing.outbox (seq) WHERE published_at IS NULL;

CREATE FUNCTION ticketing.guard_outbox_update()
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

CREATE TRIGGER outbox_guard_update BEFORE UPDATE ON ticketing.outbox
  FOR EACH ROW EXECUTE FUNCTION ticketing.guard_outbox_update();
CREATE TRIGGER outbox_no_delete BEFORE DELETE ON ticketing.outbox
  FOR EACH ROW EXECUTE FUNCTION app.reject_mutation();
CREATE TRIGGER outbox_no_truncate BEFORE TRUNCATE ON ticketing.outbox
  FOR EACH STATEMENT EXECUTE FUNCTION app.reject_mutation();

-- Events this module has handled, by the id of the envelope that carried them. Append-only.
CREATE TABLE ticketing.inbox (
  event_id     uuid        PRIMARY KEY,
  type         text        NOT NULL CHECK (type ~ '^[a-z]+\.[a-z_]+$'),
  processed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER inbox_append_only BEFORE UPDATE OR DELETE ON ticketing.inbox
  FOR EACH ROW EXECUTE FUNCTION app.reject_mutation();
CREATE TRIGGER inbox_no_truncate BEFORE TRUNCATE ON ticketing.inbox
  FOR EACH STATEMENT EXECUTE FUNCTION app.reject_mutation();

ALTER TABLE ticketing.outbox ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
ALTER TABLE ticketing.inbox  ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
CREATE POLICY outbox_module_read ON ticketing.outbox FOR SELECT USING (app.is_module_role());
CREATE POLICY outbox_module_write ON ticketing.outbox TO passripple_owner_ticketing
  USING (true) WITH CHECK (true);
CREATE POLICY inbox_module_read ON ticketing.inbox FOR SELECT USING (app.is_module_role());
CREATE POLICY inbox_module_write ON ticketing.inbox TO passripple_owner_ticketing
  USING (true) WITH CHECK (true);

CREATE FUNCTION ticketing.emit(p_payload jsonb)
RETURNS void
LANGUAGE sql
SET search_path = pg_catalog
AS $$
  INSERT INTO ticketing.outbox (type, payload) VALUES (p_payload ->> 'type', p_payload);
$$;

CREATE FUNCTION ticketing.outbox_claim(p_limit integer)
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
    SELECT o.id, o.type, o.payload FROM ticketing.outbox o
     WHERE o.published_at IS NULL
     ORDER BY o.seq
     LIMIT least(greatest(coalesce(p_limit, 1), 1), 100)
       FOR UPDATE SKIP LOCKED;
END
$$;

CREATE FUNCTION ticketing.outbox_mark_published(p_ids uuid[])
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
  UPDATE ticketing.outbox SET published_at = now()
   WHERE id = ANY (p_ids) AND published_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END
$$;

-- Handles order.paid: issues the order's tickets, one per fallback code, and emits
-- ticket.issued for each. p_lines is the order's lines as the Worker read them from orders,
-- each with the codes it drew for it: [{"ticketTypeId": "…", "codes": ["…", …]}, …]. A code
-- already taken fails the whole call, and the next delivery draws new ones. Returns how
-- many tickets were issued now: 0 when this message was handled before or the order
-- already has tickets.
CREATE FUNCTION ticketing.issue_order(
  p_message_id uuid, p_order_id uuid, p_event_id uuid, p_lines jsonb
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_line      jsonb;
  v_type_id   uuid;
  v_code      text;
  v_ticket_id uuid;
  v_count     integer := 0;
BEGIN
  IF app.actor_role() IS DISTINCT FROM 'system' THEN
    RAISE EXCEPTION 'only the system issues tickets' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_message_id IS NULL OR p_order_id IS NULL OR p_event_id IS NULL
     OR jsonb_typeof(p_lines) IS DISTINCT FROM 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'an order is issued from one message with at least one line'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  INSERT INTO ticketing.inbox (event_id, type) VALUES (p_message_id, 'order.paid')
  ON CONFLICT (event_id) DO NOTHING;
  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  -- Two different messages for the same order wait for each other here.
  PERFORM pg_advisory_xact_lock(hashtextextended('ticketing.issue_order/' || p_order_id::text, 0));
  IF EXISTS (SELECT 1 FROM ticketing.tickets t WHERE t.order_id = p_order_id) THEN
    RETURN 0;
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_type_id := (v_line ->> 'ticketTypeId')::uuid;
    IF jsonb_typeof(v_line -> 'codes') IS DISTINCT FROM 'array'
       OR jsonb_array_length(v_line -> 'codes') NOT BETWEEN 1 AND 1000 THEN
      RAISE EXCEPTION 'every line carries 1 to 1000 codes' USING ERRCODE = 'invalid_parameter_value';
    END IF;
    FOR v_code IN SELECT * FROM jsonb_array_elements_text(v_line -> 'codes') LOOP
      INSERT INTO ticketing.tickets (event_id, ticket_type_id, order_id, origin, code_human, entry_mode)
      VALUES (p_event_id, v_type_id, p_order_id, 'sale', v_code, 'single_use')
      RETURNING id INTO v_ticket_id;
      PERFORM ticketing.emit(jsonb_build_object(
        'type', 'ticket.issued', 'ticketId', v_ticket_id, 'eventId', p_event_id,
        'orderId', p_order_id, 'origin', 'sale', 'occurredAt', to_jsonb(now())));
      v_count := v_count + 1;
    END LOOP;
  END LOOP;
  RETURN v_count;
END
$$;

GRANT EXECUTE ON FUNCTION ticketing.outbox_claim(integer) TO passripple_api;
GRANT EXECUTE ON FUNCTION ticketing.outbox_mark_published(uuid[]) TO passripple_api;
GRANT EXECUTE ON FUNCTION ticketing.issue_order(uuid, uuid, uuid, jsonb) TO passripple_api;
