-- Binding emits its domain event (6.6). Every binding makes older certificates stale, so
-- the gates that hold them must learn of it: ticket.bound for a first binding or a
-- recovery onto a new device of the same person, ticket.transferred for a transfer to
-- another person. The event is written to this module's outbox in the same transaction
-- as the binding, so it exists if and only if the binding does.

CREATE OR REPLACE FUNCTION ticketing.bind(p_ticket_id uuid, p_holder_pubkey bytea, p_reason text)
RETURNS smallint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_status   text;
  v_version  smallint;
  v_event_id uuid;
BEGIN
  IF app.actor_role() IS DISTINCT FROM 'system' THEN
    RAISE EXCEPTION 'only the system binds tickets' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT t.status, t.key_version, t.event_id INTO v_status, v_version, v_event_id
    FROM ticketing.tickets t WHERE t.id = p_ticket_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ticket % does not exist', p_ticket_id USING ERRCODE = 'no_data_found';
  END IF;
  IF p_reason = 'bind' THEN
    IF v_status <> 'issued' THEN
      RAISE EXCEPTION 'ticket % is %, so it cannot be bound', p_ticket_id, v_status
        USING ERRCODE = 'restrict_violation';
    END IF;
  ELSIF p_reason IN ('transfer', 'recovery') THEN
    IF v_status <> 'bound' THEN
      RAISE EXCEPTION 'ticket % is %, so it cannot be rebound', p_ticket_id, v_status
        USING ERRCODE = 'restrict_violation';
    END IF;
  ELSE
    RAISE EXCEPTION 'unknown binding reason %', p_reason USING ERRCODE = 'check_violation';
  END IF;
  IF v_version >= 6 THEN
    RAISE EXCEPTION 'ticket % has reached its limit of rebindings', p_ticket_id
      USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO ticketing.ticket_bindings (ticket_id, key_version, holder_pubkey, reason)
  VALUES (p_ticket_id, v_version + 1, p_holder_pubkey, p_reason);
  UPDATE ticketing.tickets
     SET holder_pubkey = p_holder_pubkey, key_version = v_version + 1, status = 'bound'
   WHERE id = p_ticket_id;

  IF p_reason = 'transfer' THEN
    PERFORM ticketing.emit(jsonb_build_object(
      'type', 'ticket.transferred', 'ticketId', p_ticket_id, 'eventId', v_event_id,
      'keyVersion', v_version + 1, 'occurredAt', to_jsonb(now())));
  ELSE
    PERFORM ticketing.emit(jsonb_build_object(
      'type', 'ticket.bound', 'ticketId', p_ticket_id, 'eventId', v_event_id,
      'keyVersion', v_version + 1, 'reason', p_reason, 'occurredAt', to_jsonb(now())));
  END IF;
  RETURN v_version + 1;
END
$$;
