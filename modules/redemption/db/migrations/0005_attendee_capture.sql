-- Attendees captured at the gate (design 7.3, 8.4): a named ticket that arrives without its
-- attendee gets one at the door, from the document the operator has in hand. Only the name,
-- the document type and its last digits: the device has no key to encrypt a full number,
-- and the age check needs only the physical document. Append-only, never rejected (I6);
-- an operation that names a ticket of another event is still kept, like any other scan.

CREATE TABLE redemption.attendee_captures (
  -- The device's UUIDv7: an operation synced twice is the same row.
  id                 uuid        PRIMARY KEY,
  device_id          uuid        NOT NULL REFERENCES staff.staff_devices (id),
  ticket_id          uuid        NOT NULL REFERENCES ticketing.tickets (id),
  full_name          text        NOT NULL CHECK (length(full_name) BETWEEN 2 AND 120),
  doc_type           text        NOT NULL CHECK (doc_type IN ('cedula', 'dimex', 'pasaporte', 'tim')),
  doc_last4          text        NOT NULL CHECK (doc_last4 ~ '^[0-9A-Z]{2,4}$'),
  device_seq         bigint      NOT NULL CHECK (device_seq >= 0),
  occurred_at_device timestamptz NOT NULL,
  clock_offset_ms    integer     NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX attendee_captures_ticket_idx ON redemption.attendee_captures (ticket_id);
CREATE INDEX attendee_captures_device_idx ON redemption.attendee_captures (device_id);

CREATE TRIGGER attendee_captures_append_only BEFORE UPDATE OR DELETE ON redemption.attendee_captures
  FOR EACH ROW EXECUTE FUNCTION app.reject_mutation();
CREATE TRIGGER attendee_captures_no_truncate BEFORE TRUNCATE ON redemption.attendee_captures
  FOR EACH STATEMENT EXECUTE FUNCTION app.reject_mutation();

ALTER TABLE redemption.attendee_captures ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
CREATE POLICY attendee_captures_module_read ON redemption.attendee_captures FOR SELECT
  USING (app.is_module_role());
CREATE POLICY attendee_captures_module_write ON redemption.attendee_captures
  TO passripple_owner_redemption USING (true) WITH CHECK (true);
-- Administrators only, through the API: organizers see counts, not names.
CREATE POLICY attendee_captures_api_read ON redemption.attendee_captures FOR SELECT
  TO passripple_api USING ((SELECT app.actor_role()) = 'admin');
GRANT SELECT ON redemption.attendee_captures TO passripple_api;

-- apply_batch, now with attendee_capture: {"ticketId", "fullName", "docType", "docLast4"}.
CREATE OR REPLACE FUNCTION redemption.apply_batch(p_device_id uuid, p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_item       jsonb;
  v_results    jsonb := '[]'::jsonb;
  v_id         uuid;
  v_raw_id     text;
  v_op         text;
  v_seq        bigint;
  v_at         timestamptz;
  v_offset     integer;
  v_outcome    text;
  v_inserted   uuid;
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
      v_op := v_item->>'opType';
      v_seq := (v_item->>'deviceSeq')::bigint;
      v_at := to_timestamp((v_item->>'createdAt')::double precision / 1000.0);
      v_offset := coalesce((v_item->>'clockOffsetMs')::integer, 0);
      IF v_id IS NULL OR v_seq IS NULL OR v_at IS NULL THEN
        RAISE EXCEPTION 'an operation needs id, deviceSeq and createdAt' USING ERRCODE = 'not_null_violation';
      END IF;

      IF v_op IN ('redemption', 'staff_scan') THEN
        SELECT r.outcome INTO v_outcome FROM redemption.redemptions r WHERE r.id = v_id;
        IF FOUND THEN
          v_results := v_results || jsonb_build_object('id', v_id, 'status', 'duplicate', 'outcome', v_outcome);
        ELSE
          v_outcome := redemption.apply_scan(p_device_id, v_id, v_seq, v_at, v_offset, v_item->'payload');
          v_results := v_results || jsonb_build_object('id', v_id, 'status', 'applied', 'outcome', v_outcome);
        END IF;

      ELSIF v_op = 'incident' THEN
        INSERT INTO redemption.incidents (id, device_id, ticket_id, kind, source, device_seq,
                                          occurred_at_device, clock_offset_ms, note)
        VALUES (v_id, p_device_id, (v_item->'payload'->>'ticketId')::uuid, v_item->'payload'->>'kind', 'device',
                v_seq, v_at, v_offset, v_item->'payload'->>'note')
        ON CONFLICT (id) DO NOTHING
        RETURNING id INTO v_inserted;
        v_results := v_results || jsonb_build_object(
          'id', v_id, 'status', CASE WHEN v_inserted IS NULL THEN 'duplicate' ELSE 'applied' END);
        v_inserted := NULL;

      ELSIF v_op = 'attendee_capture' THEN
        INSERT INTO redemption.attendee_captures (id, device_id, ticket_id, full_name, doc_type,
                                                  doc_last4, device_seq, occurred_at_device,
                                                  clock_offset_ms)
        VALUES (v_id, p_device_id, (v_item->'payload'->>'ticketId')::uuid,
                btrim(v_item->'payload'->>'fullName'), v_item->'payload'->>'docType',
                upper(v_item->'payload'->>'docLast4'), v_seq, v_at, v_offset)
        ON CONFLICT (id) DO NOTHING
        RETURNING id INTO v_inserted;
        v_results := v_results || jsonb_build_object(
          'id', v_id, 'status', CASE WHEN v_inserted IS NULL THEN 'duplicate' ELSE 'applied' END);
        v_inserted := NULL;

      ELSE
        RAISE EXCEPTION 'unknown operation type %', coalesce(v_op, 'null') USING ERRCODE = 'invalid_parameter_value';
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_results := v_results || jsonb_build_object(
        'id', v_raw_id, 'status', 'rejected', 'error', SQLSTATE || ': ' || SQLERRM);
    END;
  END LOOP;
  RETURN v_results;
END
$$;
