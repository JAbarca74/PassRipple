-- The event ledger: every movement of an event's money, append-only. Nothing is edited or
-- deleted; a mistake is corrected with an adjustment that states its reason. Payout
-- statements and invariant I9 arrive in Phase 4.

CREATE TABLE settlement.ledger_entries (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id   uuid        NOT NULL REFERENCES events.events (id),
  kind       text        NOT NULL
             CHECK (kind IN ('payment_in', 'door_sale', 'fee', 'fee_tax', 'refund', 'adjustment', 'payout')),
  -- Signed, in whole colones.
  amount_crc integer     NOT NULL CHECK (amount_crc <> 0),
  -- Bank reference of the movement, when there is one.
  reference  text        CHECK (btrim(reference) <> ''),
  -- Required for adjustments.
  reason     text,
  -- The user who recorded it; NULL when the system did.
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (kind <> 'adjustment' OR btrim(coalesce(reason, '')) <> '')
);
CREATE INDEX ledger_entries_event_idx ON settlement.ledger_entries (event_id, created_at);

-- No role, the owner included, updates, deletes or truncates the ledger.
CREATE TRIGGER ledger_entries_append_only BEFORE UPDATE OR DELETE ON settlement.ledger_entries
  FOR EACH ROW EXECUTE FUNCTION app.reject_mutation();
CREATE TRIGGER ledger_entries_no_truncate BEFORE TRUNCATE ON settlement.ledger_entries
  FOR EACH STATEMENT EXECUTE FUNCTION app.reject_mutation();

-- ── Row Level Security ───────────────────────────────────────────────────────
-- The API never writes the ledger. Organizers read their organization's events.
ALTER TABLE settlement.ledger_entries ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;

CREATE POLICY ledger_entries_module_read ON settlement.ledger_entries FOR SELECT USING (app.is_module_role());
CREATE POLICY ledger_entries_module_write ON settlement.ledger_entries TO passripple_owner_settlement
  USING (true) WITH CHECK (true);
CREATE POLICY ledger_entries_api_read ON settlement.ledger_entries FOR SELECT TO passripple_api
  USING ((SELECT app.actor_role()) = 'admin' OR EXISTS (
    SELECT 1 FROM events.events e
     WHERE e.id = ledger_entries.event_id
       AND (SELECT app.actor_role()) = 'organizer' AND e.org_id = (SELECT app.org_id())));

GRANT USAGE ON SCHEMA settlement TO passripple_api;
GRANT SELECT ON settlement.ledger_entries TO passripple_api;

-- ── Functions ────────────────────────────────────────────────────────────────
-- Records one ledger entry. The system records movements as they happen; only an
-- administrator records adjustments.
CREATE FUNCTION settlement.record_entry(
  p_event_id uuid, p_kind text, p_amount_crc integer, p_reference text, p_reason text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_entry_id uuid;
BEGIN
  IF NOT coalesce(app.actor_role() = 'admin'
                  OR (app.actor_role() = 'system' AND p_kind <> 'adjustment'), false) THEN
    RAISE EXCEPTION 'this actor cannot record % entries', p_kind USING ERRCODE = 'insufficient_privilege';
  END IF;
  INSERT INTO settlement.ledger_entries (event_id, kind, amount_crc, reference, reason, created_by)
  VALUES (p_event_id, p_kind, p_amount_crc, p_reference, p_reason, app.actor_id())
  RETURNING id INTO v_entry_id;
  RETURN v_entry_id;
END
$$;

GRANT EXECUTE ON FUNCTION settlement.record_entry(uuid, text, integer, text, text) TO passripple_api;
