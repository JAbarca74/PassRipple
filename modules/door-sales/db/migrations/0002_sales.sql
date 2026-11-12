-- Door sales (design 10.6, 8.4): the person pays the organizer at the door, in cash or by
-- SINPE to the organizer's own number, and the staff takes a ticket from the device's block
-- (inventory.device_blocks). The money never touches the collection account, but the sale
-- is recorded here so settlement deducts its commission and it counts for capacity, the
-- dashboard and the municipal return. Recorded offline and uploaded later: never refused
-- for capacity, which the block already took (I6).

CREATE TABLE door_sales.sales (
  -- The device's UUIDv7: a sale synced twice is the same row.
  id                 uuid        PRIMARY KEY,
  event_id           uuid        NOT NULL REFERENCES events.events (id),
  block_id           uuid        NOT NULL REFERENCES inventory.device_blocks (id),
  device_id          uuid        NOT NULL REFERENCES staff.staff_devices (id),
  ticket_id          uuid        NOT NULL UNIQUE REFERENCES ticketing.tickets (id),
  method             text        NOT NULL CHECK (method IN ('cash', 'sinpe')),
  -- What the person paid the organizer, in colones.
  amount_crc         integer     NOT NULL CHECK (amount_crc >= 0),
  device_seq         bigint      NOT NULL CHECK (device_seq >= 0),
  occurred_at_device timestamptz NOT NULL,
  clock_offset_ms    integer     NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sales_event_idx ON door_sales.sales (event_id);
CREATE INDEX sales_device_idx ON door_sales.sales (device_id);
CREATE INDEX sales_block_idx ON door_sales.sales (block_id);

CREATE TRIGGER sales_append_only BEFORE UPDATE OR DELETE ON door_sales.sales
  FOR EACH ROW EXECUTE FUNCTION app.reject_mutation();
CREATE TRIGGER sales_no_truncate BEFORE TRUNCATE ON door_sales.sales
  FOR EACH STATEMENT EXECUTE FUNCTION app.reject_mutation();

ALTER TABLE door_sales.sales ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
CREATE POLICY sales_module_read ON door_sales.sales FOR SELECT USING (app.is_module_role());
CREATE POLICY sales_module_write ON door_sales.sales TO passripple_owner_door_sales
  USING (true) WITH CHECK (true);
CREATE POLICY sales_api_read ON door_sales.sales FOR SELECT TO passripple_api
  USING ((SELECT app.actor_role()) = 'admin' OR EXISTS (
    SELECT 1 FROM events.events e
     WHERE e.id = sales.event_id
       AND (SELECT app.actor_role()) = 'organizer' AND e.org_id = (SELECT app.org_id())));
GRANT USAGE ON SCHEMA door_sales TO passripple_api;
GRANT SELECT ON door_sales.sales TO passripple_api;

-- Applies the door_sale operations of one device's batch and returns one result per
-- operation, in order, like redemption.apply_batch: {"id", "status": "applied" |
-- "duplicate" | "rejected", "error"?}. An operation: {"id", "deviceSeq", "createdAt"
-- (device milliseconds), "clockOffsetMs", "payload": {"ticketId", "method", "amountCrc"}}.
-- The ticket must be in a block of this device: that is the only thing that can fail, and
-- only for a malformed or tampered operation.
CREATE FUNCTION door_sales.apply_sales(p_device_id uuid, p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_item     jsonb;
  v_results  jsonb := '[]'::jsonb;
  v_raw_id   text;
  v_id       uuid;
  v_ticket   uuid;
  v_block    inventory.device_blocks;
  v_inserted uuid;
BEGIN
  IF NOT coalesce(app.actor_role() = 'staff'
                  AND EXISTS (SELECT 1 FROM staff.staff_devices d
                               WHERE d.id = p_device_id AND d.user_id = app.actor_id()), false) THEN
    RAISE EXCEPTION 'device % is not available to this actor', p_device_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'a batch holds 1 to 100 operations' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    v_raw_id := v_item->>'id';
    BEGIN
      v_id := v_raw_id::uuid;
      v_ticket := (v_item->'payload'->>'ticketId')::uuid;
      SELECT b.* INTO v_block
        FROM ticketing.tickets t
        JOIN inventory.device_blocks b ON b.id = t.block_id
       WHERE t.id = v_ticket AND b.device_id = p_device_id AND b.purpose = 'door_sale';
      IF NOT FOUND THEN
        RAISE EXCEPTION 'ticket % is not in a door-sale block of device %', v_ticket, p_device_id
          USING ERRCODE = 'invalid_parameter_value';
      END IF;

      INSERT INTO door_sales.sales (id, event_id, block_id, device_id, ticket_id, method, amount_crc,
                                    device_seq, occurred_at_device, clock_offset_ms)
      VALUES (v_id, v_block.event_id, v_block.id, p_device_id, v_ticket,
              v_item->'payload'->>'method', (v_item->'payload'->>'amountCrc')::integer,
              (v_item->>'deviceSeq')::bigint,
              to_timestamp((v_item->>'createdAt')::double precision / 1000.0),
              coalesce((v_item->>'clockOffsetMs')::integer, 0))
      ON CONFLICT (id) DO NOTHING
      RETURNING id INTO v_inserted;

      IF v_inserted IS NULL THEN
        v_results := v_results || jsonb_build_object('id', v_id, 'status', 'duplicate');
      ELSE
        PERFORM ticketing.release_from_block(v_ticket, v_block.id);
        v_results := v_results || jsonb_build_object('id', v_id, 'status', 'applied');
      END IF;
      v_inserted := NULL;
    EXCEPTION WHEN OTHERS THEN
      v_results := v_results || jsonb_build_object(
        'id', v_raw_id, 'status', 'rejected', 'error', SQLSTATE || ': ' || SQLERRM);
    END;
  END LOOP;
  RETURN v_results;
END
$$;

GRANT EXECUTE ON FUNCTION door_sales.apply_sales(uuid, jsonb) TO passripple_api;
