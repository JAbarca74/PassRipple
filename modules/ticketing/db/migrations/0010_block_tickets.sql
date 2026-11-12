-- Tickets of a device block (design 8.5, 10.6): pre-issued as `unsold` when the block is
-- assigned, so the gate device already has them in its manifest; a door sale or an offline
-- courtesy turns one into `issued`, and closing the block voids the rest.

CREATE INDEX tickets_block_idx ON ticketing.tickets (block_id) WHERE block_id IS NOT NULL;

-- Pre-issues one unsold ticket per code for a block. The system only, in the transaction
-- that took the seats (inventory.assign_block). Returns how many.
CREATE FUNCTION ticketing.issue_block(
  p_block_id uuid, p_event_id uuid, p_ticket_type_id uuid, p_origin text, p_codes text[]
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_entry_mode text;
  v_count      integer;
BEGIN
  IF app.actor_role() IS DISTINCT FROM 'system' THEN
    RAISE EXCEPTION 'only the system issues tickets' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_origin NOT IN ('door_sale', 'courtesy') THEN
    RAISE EXCEPTION 'a block holds door sales or courtesies' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT t.entry_mode INTO v_entry_mode FROM catalog.ticket_types t
   WHERE t.id = p_ticket_type_id AND t.event_id = p_event_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ticket type % is not of event %', p_ticket_type_id, p_event_id
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  INSERT INTO ticketing.tickets (event_id, ticket_type_id, origin, block_id, code_human, entry_mode, status)
  SELECT p_event_id, p_ticket_type_id, p_origin, p_block_id, code, v_entry_mode, 'unsold'
    FROM unnest(p_codes) AS code;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END
$$;

-- Turns an unsold ticket of the block into an issued one. Returns false when it was
-- already issued (the same sale synced twice); raises when it is not of the block or void.
CREATE FUNCTION ticketing.release_from_block(p_ticket_id uuid, p_block_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_ticket ticketing.tickets;
BEGIN
  SELECT * INTO v_ticket FROM ticketing.tickets WHERE id = p_ticket_id FOR UPDATE;
  IF NOT FOUND OR v_ticket.block_id IS DISTINCT FROM p_block_id THEN
    RAISE EXCEPTION 'ticket % is not of block %', p_ticket_id, p_block_id
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF v_ticket.status = 'unsold' THEN
    UPDATE ticketing.tickets SET status = 'issued' WHERE id = p_ticket_id;
    RETURN true;
  END IF;
  IF v_ticket.status = 'void' THEN
    RAISE EXCEPTION 'ticket % is void', p_ticket_id USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  RETURN false;
END
$$;

-- Voids the unsold tickets of a block when it closes. The system only. Returns how many,
-- the seats to give back to the counter.
CREATE FUNCTION ticketing.void_unsold(p_block_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_count integer;
BEGIN
  IF app.actor_role() IS DISTINCT FROM 'system' THEN
    RAISE EXCEPTION 'only the system voids block tickets' USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE ticketing.tickets SET status = 'void' WHERE block_id = p_block_id AND status = 'unsold';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END
$$;

GRANT EXECUTE ON FUNCTION ticketing.issue_block(uuid, uuid, uuid, text, text[]) TO passripple_api;
GRANT EXECUTE ON FUNCTION ticketing.void_unsold(uuid) TO passripple_api;
