-- Invariant I1: a public ticket is redeemed exactly once; only staff and performer
-- tickets have multi-scan entry. Every scan synced from a gate device is recorded,
-- because no offline operation may be lost or rejected (I6): a second scan of a
-- single-use ticket is stored as a duplicate, never as a second admission. The partial
-- UNIQUE index below makes a second admission impossible for every role (ADR 0012).
-- redemption.apply_batch, the offline batch entry point, arrives in Phase 2.

CREATE TABLE redemption.redemptions (
  -- UUID v7 generated on the device: a scan synced twice is the same row.
  id                uuid        PRIMARY KEY,
  ticket_id         uuid        NOT NULL REFERENCES ticketing.tickets (id),
  device_id         uuid        NOT NULL REFERENCES staff.staff_devices (id),
  -- The device's monotonic counter: the real order of its operations.
  device_seq        bigint      NOT NULL CHECK (device_seq >= 0),
  scanned_at_device timestamptz NOT NULL,
  clock_offset_ms   integer     NOT NULL DEFAULT 0,
  method            text        NOT NULL CHECK (method IN ('qr', 'manual')),
  id_checked        boolean     NOT NULL DEFAULT false,
  -- Copied from the ticket when the scan is recorded, whatever the caller passes.
  entry_mode        text        NOT NULL CHECK (entry_mode IN ('single_use', 'multi_scan')),
  -- admitted: the person entered; duplicate: a single-use ticket already admitted.
  outcome           text        NOT NULL CHECK (outcome IN ('admitted', 'duplicate')),
  synced_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (device_id, device_seq),
  CHECK (outcome = 'admitted' OR entry_mode = 'single_use')
);
CREATE INDEX redemptions_ticket_idx ON redemption.redemptions (ticket_id);

-- I1: at most one admission per single-use ticket.
CREATE UNIQUE INDEX redemptions_single_use_once ON redemption.redemptions (ticket_id)
  WHERE outcome = 'admitted' AND entry_mode = 'single_use';

-- The entry mode comes from the ticket, and the ticket must belong to the device's event.
CREATE FUNCTION redemption.derive_redemption()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
  v_ticket_event uuid;
  v_entry_mode   text;
  v_device_event uuid;
BEGIN
  SELECT t.event_id, t.entry_mode INTO v_ticket_event, v_entry_mode
    FROM ticketing.tickets t WHERE t.id = NEW.ticket_id;
  SELECT d.event_id INTO v_device_event FROM staff.staff_devices d WHERE d.id = NEW.device_id;
  IF v_ticket_event IS DISTINCT FROM v_device_event THEN
    RAISE EXCEPTION 'ticket % does not belong to the event of device %', NEW.ticket_id, NEW.device_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  NEW.entry_mode := v_entry_mode;
  RETURN NEW;
END
$$;

CREATE TRIGGER redemptions_derive BEFORE INSERT ON redemption.redemptions
  FOR EACH ROW EXECUTE FUNCTION redemption.derive_redemption();
-- Append-only: no role, the owner included, turns a duplicate into an admission or
-- removes an admission to admit the ticket again.
CREATE TRIGGER redemptions_append_only BEFORE UPDATE OR DELETE ON redemption.redemptions
  FOR EACH ROW EXECUTE FUNCTION app.reject_mutation();
CREATE TRIGGER redemptions_no_truncate BEFORE TRUNCATE ON redemption.redemptions
  FOR EACH STATEMENT EXECUTE FUNCTION app.reject_mutation();

-- ── Row Level Security ───────────────────────────────────────────────────────
ALTER TABLE redemption.redemptions ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;

CREATE POLICY redemptions_module_read ON redemption.redemptions FOR SELECT USING (app.is_module_role());
CREATE POLICY redemptions_module_write ON redemption.redemptions TO passripple_owner_redemption
  USING (true) WITH CHECK (true);
-- Reads through the devices, whose own policy limits organizers to their events and
-- staff to their own devices.
CREATE POLICY redemptions_api_read ON redemption.redemptions FOR SELECT TO passripple_api
  USING ((SELECT app.actor_role()) = 'admin'
         OR EXISTS (SELECT 1 FROM staff.staff_devices d WHERE d.id = redemptions.device_id));

GRANT USAGE ON SCHEMA redemption TO passripple_api;
GRANT SELECT ON redemption.redemptions TO passripple_api;

-- ── Functions ────────────────────────────────────────────────────────────────
-- Records one scan and returns its outcome: admitted or duplicate. Idempotent by the
-- device-generated id: the same scan synced again returns its first outcome. Never
-- rejects a valid scan (I6); the partial UNIQUE index decides concurrent admissions.
CREATE FUNCTION redemption.record_scan(
  p_id uuid,
  p_ticket_id uuid,
  p_device_id uuid,
  p_device_seq bigint,
  p_scanned_at_device timestamptz,
  p_clock_offset_ms integer,
  p_method text,
  p_id_checked boolean
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_outcome text;
  v_id      uuid;
BEGIN
  IF NOT coalesce(app.actor_role() = 'system'
                  OR (app.actor_role() = 'staff'
                      AND EXISTS (SELECT 1 FROM staff.staff_devices d
                                   WHERE d.id = p_device_id AND d.user_id = app.actor_id())), false) THEN
    RAISE EXCEPTION 'device % is not available to this actor', p_device_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT outcome INTO v_outcome FROM redemption.redemptions WHERE id = p_id;
  IF FOUND THEN
    RETURN v_outcome;
  END IF;

  INSERT INTO redemption.redemptions (id, ticket_id, device_id, device_seq, scanned_at_device,
                                      clock_offset_ms, method, id_checked, entry_mode, outcome)
  VALUES (p_id, p_ticket_id, p_device_id, p_device_seq, p_scanned_at_device,
          coalesce(p_clock_offset_ms, 0), p_method, coalesce(p_id_checked, false), 'single_use', 'admitted')
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NOT NULL THEN
    RETURN 'admitted';
  END IF;

  -- Something already holds this scan's place: the same scan synced concurrently, a
  -- reused device sequence number, or an earlier admission of this single-use ticket.
  SELECT outcome INTO v_outcome FROM redemption.redemptions WHERE id = p_id;
  IF FOUND THEN
    RETURN v_outcome;
  END IF;
  IF EXISTS (SELECT 1 FROM redemption.redemptions
              WHERE device_id = p_device_id AND device_seq = p_device_seq) THEN
    RAISE EXCEPTION 'device % already used sequence number %', p_device_id, p_device_seq
      USING ERRCODE = 'unique_violation';
  END IF;

  INSERT INTO redemption.redemptions (id, ticket_id, device_id, device_seq, scanned_at_device,
                                      clock_offset_ms, method, id_checked, entry_mode, outcome)
  VALUES (p_id, p_ticket_id, p_device_id, p_device_seq, p_scanned_at_device,
          coalesce(p_clock_offset_ms, 0), p_method, coalesce(p_id_checked, false), 'single_use', 'duplicate');
  RETURN 'duplicate';
END
$$;

GRANT EXECUTE ON FUNCTION redemption.record_scan(uuid, uuid, uuid, bigint, timestamptz, integer, text, boolean)
  TO passripple_api;
