-- Seats of complimentary tickets granted online (design I2, I3): a courtesy takes capacity
-- like a sale, for good, with no hold in between. The system only, in the transaction where
-- courtesy.grant_tickets counted it against the declared quota (I3). Returns false when the
-- seats do not fit.

CREATE FUNCTION inventory.commit_courtesy(p_event_id uuid, p_ticket_type_id uuid, p_quantity integer)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF app.actor_role() IS DISTINCT FROM 'system' THEN
    RAISE EXCEPTION 'only the system commits courtesy seats' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_quantity IS NULL OR p_quantity NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'a courtesy has 1 to 100 tickets' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM catalog.ticket_types t
                  WHERE t.id = p_ticket_type_id AND t.event_id = p_event_id) THEN
    RAISE EXCEPTION 'ticket type % is not of event %', p_ticket_type_id, p_event_id
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  UPDATE inventory.event_capacity c
     SET committed = c.committed + p_quantity, updated_at = now()
    FROM events.events e
   WHERE c.event_id = p_event_id
     AND e.id = c.event_id
     AND e.status = 'on_sale'
     AND c.committed + p_quantity <= c.permitted_capacity;
  RETURN FOUND;
END
$$;

GRANT EXECUTE ON FUNCTION inventory.commit_courtesy(uuid, uuid, integer) TO passripple_api;
