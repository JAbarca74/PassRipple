-- Offline batches from gate devices (design 8.7) and the incidents reconciliation raises
-- (8.11). redemption.apply_batch applies up to 100 operations in one call and answers per
-- operation: applied, duplicate (already applied: the same id synced again) or rejected.
-- Each operation runs in its own EXCEPTION block, so one bad operation never fails the
-- batch. No queued operation is meant to be rejectable (I6, 8.5): a rejection means a
-- malformed or inconsistent operation, which the device quarantines for a person.
--
-- Reconciliation never undoes anything. It records an incident when a single-use ticket
-- admitted on one device is scanned on another, when a device admitted a ticket missing
-- from its manifest, and when a revoked device recorded a scan after its revocation.

CREATE TABLE redemption.incidents (
  -- The device's UUIDv7 for incidents it reports; the server's for reconciliation.
  id                 uuid        PRIMARY KEY,
  device_id          uuid        NOT NULL REFERENCES staff.staff_devices (id),
  ticket_id          uuid        REFERENCES ticketing.tickets (id),
  -- The scan that raised it, for reconciliation incidents.
  redemption_id      uuid        REFERENCES redemption.redemptions (id),
  kind               text        NOT NULL CHECK (kind IN (
                       -- reported by the device
                       'operator', 'manual_entry_locked',
                       -- raised by reconciliation
                       'multi_device_redemption', 'out_of_manifest', 'after_revocation')),
  source             text        NOT NULL CHECK (source IN ('device', 'reconciliation')),
  -- For device incidents: its place in the device's order and when it happened there.
  device_seq         bigint      CHECK (device_seq >= 0),
  occurred_at_device timestamptz,
  clock_offset_ms    integer,
  -- A short note from the operator. No personal data belongs here.
  note               text        CHECK (length(note) <= 500),
  created_at         timestamptz NOT NULL DEFAULT now(),
  CHECK ((source = 'device') = (kind IN ('operator', 'manual_entry_locked'))),
  CHECK (source <> 'reconciliation' OR redemption_id IS NOT NULL),
  CHECK (source <> 'device' OR (device_seq IS NOT NULL AND occurred_at_device IS NOT NULL))
);
CREATE INDEX incidents_device_idx ON redemption.incidents (device_id);
CREATE INDEX incidents_ticket_idx ON redemption.incidents (ticket_id) WHERE ticket_id IS NOT NULL;
-- One reconciliation incident of each kind per scan.
CREATE UNIQUE INDEX incidents_reconciliation_once ON redemption.incidents (redemption_id, kind)
  WHERE source = 'reconciliation';

CREATE TRIGGER incidents_append_only BEFORE UPDATE OR DELETE ON redemption.incidents
  FOR EACH ROW EXECUTE FUNCTION app.reject_mutation();
CREATE TRIGGER incidents_no_truncate BEFORE TRUNCATE ON redemption.incidents
  FOR EACH STATEMENT EXECUTE FUNCTION app.reject_mutation();

-- ── Row Level Security ───────────────────────────────────────────────────────
ALTER TABLE redemption.incidents ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;

CREATE POLICY incidents_module_read ON redemption.incidents FOR SELECT USING (app.is_module_role());
CREATE POLICY incidents_module_write ON redemption.incidents TO passripple_owner_redemption
  USING (true) WITH CHECK (true);
-- Through the devices, whose own policy limits organizers to their events and staff to
-- their own devices.
CREATE POLICY incidents_api_read ON redemption.incidents FOR SELECT TO passripple_api
  USING ((SELECT app.actor_role()) = 'admin'
         OR EXISTS (SELECT 1 FROM staff.staff_devices d WHERE d.id = incidents.device_id));

GRANT SELECT ON redemption.incidents TO passripple_api;

-- ── Functions ────────────────────────────────────────────────────────────────
-- Records a reconciliation incident once per scan and kind.
CREATE FUNCTION redemption.raise_incident(
  p_kind text, p_device_id uuid, p_ticket_id uuid, p_redemption_id uuid
) RETURNS void
LANGUAGE sql
SET search_path = pg_catalog
AS $$
  INSERT INTO redemption.incidents (id, device_id, ticket_id, redemption_id, kind, source)
  VALUES (gen_random_uuid(), p_device_id, p_ticket_id, p_redemption_id, p_kind, 'reconciliation')
  ON CONFLICT (redemption_id, kind) WHERE source = 'reconciliation' DO NOTHING
$$;

-- Applies one scan (redemption or staff_scan) and reconciles it. Returns its outcome.
CREATE FUNCTION redemption.apply_scan(
  p_device_id uuid, p_id uuid, p_device_seq bigint, p_scanned_at timestamptz, p_offset_ms integer,
  p_payload jsonb
) RETURNS text
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
  v_ticket_id  uuid := (p_payload->>'ticketId')::uuid;
  v_outcome    text;
  v_revoked_at timestamptz;
BEGIN
  IF v_ticket_id IS NULL THEN
    RAISE EXCEPTION 'a scan names its ticket' USING ERRCODE = 'not_null_violation';
  END IF;
  v_outcome := redemption.record_scan(p_id, v_ticket_id, p_device_id, p_device_seq, p_scanned_at,
                                      p_offset_ms, p_payload->>'method',
                                      coalesce((p_payload->>'idChecked')::boolean, false));

  -- The same single-use ticket admitted on another device (8.11).
  IF v_outcome = 'duplicate' AND EXISTS (
       SELECT 1 FROM redemption.redemptions r
        WHERE r.ticket_id = v_ticket_id AND r.outcome = 'admitted' AND r.device_id <> p_device_id) THEN
    PERFORM redemption.raise_incident('multi_device_redemption', p_device_id, v_ticket_id, p_id);
  END IF;
  -- The device verified the credential but did not find the ticket in its manifest (6.3).
  IF (p_payload->>'inManifest')::boolean IS FALSE THEN
    PERFORM redemption.raise_incident('out_of_manifest', p_device_id, v_ticket_id, p_id);
  END IF;
  -- Recorded, by the device's corrected clock, after the device was revoked.
  SELECT d.revoked_at INTO v_revoked_at FROM staff.staff_devices d WHERE d.id = p_device_id;
  IF v_revoked_at IS NOT NULL
     AND p_scanned_at + make_interval(secs => coalesce(p_offset_ms, 0) / 1000.0) > v_revoked_at THEN
    PERFORM redemption.raise_incident('after_revocation', p_device_id, v_ticket_id, p_id);
  END IF;
  RETURN v_outcome;
END
$$;

-- Applies a batch of up to 100 operations from one device and returns one result per
-- operation, in order: {"id", "status": "applied" | "duplicate" | "rejected", "outcome"?
-- (scans: "admitted" | "duplicate"), "error"?}. Called by the device's own staff member,
-- whatever the device's status: a revoked or expired device still uploads what it
-- recorded (I6, ADR 0018). Idempotent by each operation's device-generated id.
--
-- An operation: {"id", "deviceSeq", "opType", "createdAt" (device milliseconds),
-- "clockOffsetMs", "payload"}. Scans (redemption, staff_scan) carry {"ticketId", "method",
-- "idChecked", "inManifest"}; incidents carry {"kind", "ticketId"?, "note"?}.
CREATE FUNCTION redemption.apply_batch(p_device_id uuid, p_items jsonb)
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

GRANT EXECUTE ON FUNCTION redemption.apply_batch(uuid, jsonb) TO passripple_api;
