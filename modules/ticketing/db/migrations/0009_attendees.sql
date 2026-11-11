-- Attendees of named tickets (design 7.3 to 7.5). The buyer, or whoever received the ticket,
-- assigns the attendee from the wallet until the event starts; after that only the gate
-- captures it. The full document number is encrypted by the API before it gets here
-- (AES-GCM, key ATTENDEE_DOC_KEY): the database never sees it in clear, and gate devices
-- only get the last digits. It is erased after the retention period (Ley 8968).

CREATE TABLE ticketing.attendees (
  ticket_id      uuid        PRIMARY KEY REFERENCES ticketing.tickets (id),
  full_name      text        NOT NULL CHECK (length(btrim(full_name)) BETWEEN 2 AND 120),
  doc_type       text        NOT NULL CHECK (doc_type IN ('cedula', 'dimex', 'pasaporte', 'tim')),
  doc_last4      text        NOT NULL CHECK (doc_last4 ~ '^[0-9A-Z]{2,4}$'),
  -- nonce and ciphertext; NULL once erased.
  doc_number_enc bytea       CHECK (length(doc_number_enc) BETWEEN 13 AND 200),
  assigned_by    text        NOT NULL CHECK (assigned_by IN ('buyer', 'receiver', 'door')),
  assigned_at    timestamptz NOT NULL DEFAULT now(),
  purged_at      timestamptz,
  -- Gate manifests ask for what changed since a cursor, like ticketing.tickets.
  change_xid     xid8        NOT NULL DEFAULT pg_current_xact_id(),
  CHECK ((purged_at IS NULL) = (doc_number_enc IS NOT NULL))
);
CREATE TRIGGER attendees_stamp_change BEFORE INSERT OR UPDATE ON ticketing.attendees
  FOR EACH ROW EXECUTE FUNCTION ticketing.stamp_change();
CREATE TRIGGER attendees_no_delete BEFORE DELETE ON ticketing.attendees
  FOR EACH ROW EXECUTE FUNCTION app.reject_mutation();
CREATE TRIGGER attendees_no_truncate BEFORE TRUNCATE ON ticketing.attendees
  FOR EACH STATEMENT EXECUTE FUNCTION app.reject_mutation();
CREATE INDEX attendees_change_idx ON ticketing.attendees (change_xid);

-- No API grant on the table: the API goes through the functions below, and the encrypted
-- number is never read back through it.
ALTER TABLE ticketing.attendees ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
CREATE POLICY attendees_module_read ON ticketing.attendees FOR SELECT USING (app.is_module_role());
CREATE POLICY attendees_module_write ON ticketing.attendees TO passripple_owner_ticketing
  USING (true) WITH CHECK (true);

-- Assigns (or replaces) the attendee of a ticket held by p_holder_pubkey, before the event
-- starts. The API checks the holder's signature and passes the key; this checks again that
-- the key holds the ticket. Raises 55000 once the event started.
CREATE FUNCTION ticketing.assign_attendee(
  p_ticket_id uuid, p_holder_pubkey bytea, p_full_name text, p_doc_type text, p_doc_last4 text,
  p_doc_number_enc bytea, p_assigned_by text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_ticket ticketing.tickets;
  v_starts timestamptz;
  v_named  boolean;
BEGIN
  IF app.actor_role() IS DISTINCT FROM 'system' THEN
    RAISE EXCEPTION 'only the system assigns attendees' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_assigned_by NOT IN ('buyer', 'receiver') THEN
    RAISE EXCEPTION 'the wallet assigns as buyer or receiver' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_doc_number_enc IS NULL THEN
    RAISE EXCEPTION 'the document number is required' USING ERRCODE = 'not_null_violation';
  END IF;
  SELECT * INTO v_ticket FROM ticketing.tickets t WHERE t.id = p_ticket_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ticket % does not exist', p_ticket_id USING ERRCODE = 'no_data_found';
  END IF;
  IF v_ticket.status <> 'bound' OR v_ticket.holder_pubkey IS DISTINCT FROM p_holder_pubkey THEN
    RAISE EXCEPTION 'ticket % is not held by this key', p_ticket_id USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT e.starts_at, e.named_tickets INTO v_starts, v_named
    FROM events.events e WHERE e.id = v_ticket.event_id;
  IF NOT v_named THEN
    RAISE EXCEPTION 'the event of ticket % has no named tickets', p_ticket_id USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF v_starts <= now() THEN
    RAISE EXCEPTION 'the event of ticket % has started', p_ticket_id USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;

  INSERT INTO ticketing.attendees (ticket_id, full_name, doc_type, doc_last4, doc_number_enc, assigned_by)
  VALUES (p_ticket_id, btrim(p_full_name), p_doc_type, upper(p_doc_last4), p_doc_number_enc, p_assigned_by)
  ON CONFLICT (ticket_id) DO UPDATE
     SET full_name = EXCLUDED.full_name, doc_type = EXCLUDED.doc_type,
         doc_last4 = EXCLUDED.doc_last4, doc_number_enc = EXCLUDED.doc_number_enc,
         assigned_by = EXCLUDED.assigned_by, assigned_at = now(), purged_at = NULL;
END
$$;

-- What the wallet shows: the attendee of each of the given tickets, without the number.
-- The system only: the API passes the tickets the request's token reaches.
CREATE FUNCTION ticketing.attendee_view(p_ticket_ids uuid[])
RETURNS TABLE (ticket_id uuid, full_name text, doc_type text, doc_last4 text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT a.ticket_id, a.full_name, a.doc_type, a.doc_last4
    FROM ticketing.attendees a
   WHERE a.ticket_id = ANY (p_ticket_ids)
     AND app.actor_role() = 'system'
$$;

-- Erases the document numbers of events that ended more than p_days days ago. Run by the
-- jobs Worker as the system. Returns how many were erased.
CREATE FUNCTION ticketing.purge_attendee_documents(p_days integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_count integer;
BEGIN
  IF app.actor_role() IS DISTINCT FROM 'system' THEN
    RAISE EXCEPTION 'only the system erases documents' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_days IS NULL OR p_days < 0 THEN
    RAISE EXCEPTION 'the retention is zero or more days' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  UPDATE ticketing.attendees a
     SET doc_number_enc = NULL, purged_at = now()
    FROM ticketing.tickets t, events.events e
   WHERE t.id = a.ticket_id AND e.id = t.event_id
     AND a.purged_at IS NULL
     AND e.ends_at < now() - make_interval(days => p_days);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END
$$;

GRANT EXECUTE ON FUNCTION ticketing.assign_attendee(uuid, bytea, text, text, text, bytea, text)
  TO passripple_api;
GRANT EXECUTE ON FUNCTION ticketing.attendee_view(uuid[]) TO passripple_api;
GRANT EXECUTE ON FUNCTION ticketing.purge_attendee_documents(integer) TO passripple_api;
