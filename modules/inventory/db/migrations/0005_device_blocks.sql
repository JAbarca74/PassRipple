-- Device blocks (design 8.5, 10.6): before the doors open, a door-sales device gets a block
-- of seats that already went through the capacity counter (I2), so selling offline is only
-- a change of state that the server has nothing to refuse (I6). Courtesy blocks work the
-- same way for complimentary tickets granted without signal. When the device closes, the
-- seats it did not use go back to the counter.

CREATE TABLE inventory.device_blocks (
  id             uuid        PRIMARY KEY,
  event_id       uuid        NOT NULL REFERENCES inventory.event_capacity (event_id),
  ticket_type_id uuid        NOT NULL REFERENCES catalog.ticket_types (id),
  -- staff is not a dependency of inventory: no foreign key, the API checks the device.
  device_id      uuid        NOT NULL,
  purpose        text        NOT NULL CHECK (purpose IN ('door_sale', 'courtesy')),
  size           integer     NOT NULL CHECK (size BETWEEN 1 AND 1000),
  -- Seats given back to the counter when the block closed.
  returned       integer     NOT NULL DEFAULT 0 CHECK (returned >= 0),
  created_at     timestamptz NOT NULL DEFAULT now(),
  closed_at      timestamptz,
  CHECK (returned <= size),
  CHECK (closed_at IS NOT NULL OR returned = 0)
);
CREATE INDEX device_blocks_event_idx ON inventory.device_blocks (event_id);
CREATE INDEX device_blocks_device_idx ON inventory.device_blocks (device_id);

ALTER TABLE inventory.device_blocks ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
CREATE POLICY device_blocks_module_read ON inventory.device_blocks FOR SELECT
  USING (app.is_module_role());
CREATE POLICY device_blocks_module_write ON inventory.device_blocks
  TO passripple_owner_inventory USING (true) WITH CHECK (true);
CREATE POLICY device_blocks_api_read ON inventory.device_blocks FOR SELECT TO passripple_api
  USING ((SELECT app.actor_role()) IN ('admin', 'system') OR EXISTS (
    SELECT 1 FROM events.events e
     WHERE e.id = device_blocks.event_id
       AND (SELECT app.actor_role()) = 'organizer' AND e.org_id = (SELECT app.org_id())));
GRANT SELECT ON inventory.device_blocks TO passripple_api;

-- Takes p_size seats for a device, if the event is on sale and they fit (I2). The system
-- only: the API checks first that the organizer manages the event and that the device
-- belongs to it with the right role. Returns false when the seats do not fit.
CREATE FUNCTION inventory.assign_block(
  p_block_id uuid, p_event_id uuid, p_ticket_type_id uuid, p_device_id uuid, p_size integer,
  p_purpose text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF app.actor_role() IS DISTINCT FROM 'system' THEN
    RAISE EXCEPTION 'only the system assigns blocks' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_size IS NULL OR p_size NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'a block has 1 to 1000 seats' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM catalog.ticket_types t
                  WHERE t.id = p_ticket_type_id AND t.event_id = p_event_id) THEN
    RAISE EXCEPTION 'ticket type % is not of event %', p_ticket_type_id, p_event_id
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  UPDATE inventory.event_capacity c
     SET committed = c.committed + p_size, updated_at = now()
    FROM events.events e
   WHERE c.event_id = p_event_id
     AND e.id = c.event_id
     AND e.status = 'on_sale'
     AND c.committed + p_size <= c.permitted_capacity;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  INSERT INTO inventory.device_blocks (id, event_id, ticket_type_id, device_id, purpose, size)
  VALUES (p_block_id, p_event_id, p_ticket_type_id, p_device_id, p_purpose, p_size);
  RETURN true;
END
$$;

-- Closes a block and gives p_unused seats back to the counter. Once only.
CREATE FUNCTION inventory.close_block(p_block_id uuid, p_unused integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_block inventory.device_blocks;
BEGIN
  IF app.actor_role() IS DISTINCT FROM 'system' THEN
    RAISE EXCEPTION 'only the system closes blocks' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO v_block FROM inventory.device_blocks WHERE id = p_block_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'block % does not exist', p_block_id USING ERRCODE = 'no_data_found';
  END IF;
  IF v_block.closed_at IS NOT NULL THEN
    RAISE EXCEPTION 'block % is already closed', p_block_id USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF p_unused IS NULL OR p_unused < 0 OR p_unused > v_block.size THEN
    RAISE EXCEPTION 'a block gives back 0 to % seats', v_block.size USING ERRCODE = 'invalid_parameter_value';
  END IF;
  UPDATE inventory.event_capacity
     SET committed = committed - p_unused, updated_at = now()
   WHERE event_id = v_block.event_id;
  UPDATE inventory.device_blocks SET closed_at = now(), returned = p_unused WHERE id = p_block_id;
END
$$;

GRANT EXECUTE ON FUNCTION inventory.assign_block(uuid, uuid, uuid, uuid, integer, text) TO passripple_api;
GRANT EXECUTE ON FUNCTION inventory.close_block(uuid, integer) TO passripple_api;
