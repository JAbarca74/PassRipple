-- Phase 4 (part A): booking confirmed sales into the event ledger, invariant I9 (an
-- organizer's payout never exceeds what their event collected minus fees and refunds),
-- payout records and confirmation, event statements and platform totals (ADR 0039).

-- ── Inbox for idempotent event consumption ───────────────────────────────────
CREATE TABLE settlement.inbox (
  message_id  uuid        PRIMARY KEY,
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER inbox_append_only BEFORE UPDATE OR DELETE ON settlement.inbox
  FOR EACH ROW EXECUTE FUNCTION app.reject_mutation();
CREATE TRIGGER inbox_no_truncate BEFORE TRUNCATE ON settlement.inbox
  FOR EACH STATEMENT EXECUTE FUNCTION app.reject_mutation();

ALTER TABLE settlement.inbox ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
CREATE POLICY inbox_module_read ON settlement.inbox FOR SELECT USING (app.is_module_role());
CREATE POLICY inbox_module_write ON settlement.inbox TO passripple_owner_settlement
  USING (true) WITH CHECK (true);

-- ── Payment idempotency on ledger entries ────────────────────────────────────
ALTER TABLE settlement.ledger_entries ADD COLUMN payment_id uuid;

CREATE UNIQUE INDEX ledger_entries_payment_in_uidx
  ON settlement.ledger_entries (payment_id)
  WHERE kind = 'payment_in';

-- ── Booking a confirmed sale ─────────────────────────────────────────────────
-- Handles payment.succeeded: records payment_in (+amount paid, including any unique-amount
-- offset), fee (-total service fee) and fee_tax (-total fee tax) for a paid order, skipping
-- zero-amount entries because ledger_entries forbids 0. Idempotent by message_id and by
-- payment_id: returns true when booked now, false when already handled.
CREATE FUNCTION settlement.record_sale(
  p_message_id uuid,
  p_payment_id uuid,
  p_order_id   uuid,
  p_event_id   uuid,
  p_amount_crc integer,
  p_reference  text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_order record;
  v_ref   text := nullif(btrim(p_reference), '');
BEGIN
  IF app.actor_role() IS DISTINCT FROM 'system' THEN
    RAISE EXCEPTION 'only the system records sales' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_message_id IS NULL OR p_payment_id IS NULL OR p_order_id IS NULL
     OR p_event_id IS NULL OR p_amount_crc IS NULL OR p_amount_crc <= 0 THEN
    RAISE EXCEPTION 'sale parameters are required and amount_crc must be positive'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  INSERT INTO settlement.inbox (message_id) VALUES (p_message_id)
  ON CONFLICT (message_id) DO NOTHING;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1 FROM settlement.ledger_entries le
     WHERE le.payment_id = p_payment_id AND le.kind = 'payment_in'
  ) THEN
    RETURN false;
  END IF;

  SELECT * INTO v_order FROM orders.order_fee_totals(p_order_id);
  IF NOT FOUND OR v_order.event_id IS DISTINCT FROM p_event_id OR v_order.status <> 'paid' THEN
    RAISE EXCEPTION 'order % is not a paid order of event %', p_order_id, p_event_id
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;

  INSERT INTO settlement.ledger_entries (event_id, kind, amount_crc, reference, payment_id)
  VALUES (p_event_id, 'payment_in', p_amount_crc, v_ref, p_payment_id)
  ON CONFLICT (payment_id) WHERE kind = 'payment_in' DO NOTHING;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_order.fee_crc > 0 THEN
    INSERT INTO settlement.ledger_entries (event_id, kind, amount_crc, reference)
    VALUES (p_event_id, 'fee', -v_order.fee_crc, v_ref);
  END IF;

  IF v_order.fee_tax_crc > 0 THEN
    INSERT INTO settlement.ledger_entries (event_id, kind, amount_crc, reference)
    VALUES (p_event_id, 'fee_tax', -v_order.fee_tax_crc, v_ref);
  END IF;

  RETURN true;
END
$$;

-- ── Invariant I9 ─────────────────────────────────────────────────────────────
-- An organizer's payout (and any refund or negative adjustment) never leaves the event's
-- custody balance negative. Serializes outflows per event with a transaction advisory lock.
CREATE FUNCTION settlement.enforce_i9()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_balance bigint;
BEGIN
  IF NEW.kind IN ('payout', 'refund') AND NEW.amount_crc > 0 THEN
    RAISE EXCEPTION '% entry for event % must be negative', NEW.kind, NEW.event_id
      USING ERRCODE = 'check_violation';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.event_id::text, 0));

  SELECT coalesce(sum(le.amount_crc), 0)
    INTO v_balance
    FROM settlement.ledger_entries le
   WHERE le.event_id = NEW.event_id
     AND le.kind <> 'door_sale';

  IF v_balance + NEW.amount_crc < 0 THEN
    RAISE EXCEPTION 'I9: balance for event % cannot become negative (% + %)',
      NEW.event_id, v_balance, NEW.amount_crc
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER ledger_entries_enforce_i9
  BEFORE INSERT ON settlement.ledger_entries
  FOR EACH ROW
  WHEN (NEW.kind IN ('payout', 'refund') OR (NEW.kind = 'adjustment' AND NEW.amount_crc < 0))
  EXECUTE FUNCTION settlement.enforce_i9();

-- ── Payouts ──────────────────────────────────────────────────────────────────
CREATE TABLE settlement.payouts (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id     uuid        NOT NULL UNIQUE REFERENCES events.events (id),
  amount_crc   integer     NOT NULL CHECK (amount_crc > 0),
  sinpe_ref    text        NOT NULL CHECK (btrim(sinpe_ref) <> ''),
  paid_at      timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  due_at       timestamptz NOT NULL,
  created_by   uuid
);

CREATE FUNCTION settlement.guard_payout_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF (NEW.id, NEW.event_id, NEW.amount_crc, NEW.sinpe_ref, NEW.paid_at, NEW.due_at, NEW.created_by)
     IS DISTINCT FROM
     (OLD.id, OLD.event_id, OLD.amount_crc, OLD.sinpe_ref, OLD.paid_at, OLD.due_at, OLD.created_by)
     OR OLD.confirmed_at IS NOT NULL THEN
    RAISE EXCEPTION 'payout %: only an unconfirmed payout can be marked confirmed', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER payouts_guard_update BEFORE UPDATE ON settlement.payouts
  FOR EACH ROW EXECUTE FUNCTION settlement.guard_payout_update();
CREATE TRIGGER payouts_no_delete BEFORE DELETE ON settlement.payouts
  FOR EACH ROW EXECUTE FUNCTION app.reject_mutation();
CREATE TRIGGER payouts_no_truncate BEFORE TRUNCATE ON settlement.payouts
  FOR EACH STATEMENT EXECUTE FUNCTION app.reject_mutation();

ALTER TABLE settlement.payouts ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;

CREATE POLICY payouts_module_read ON settlement.payouts FOR SELECT USING (app.is_module_role());
CREATE POLICY payouts_module_write ON settlement.payouts TO passripple_owner_settlement
  USING (true) WITH CHECK (true);
CREATE POLICY payouts_api_read ON settlement.payouts FOR SELECT TO passripple_api
  USING ((SELECT app.actor_role()) = 'admin' OR EXISTS (
    SELECT 1 FROM events.events e
     WHERE e.id = payouts.event_id
       AND (SELECT app.actor_role()) = 'organizer' AND e.org_id = (SELECT app.org_id())));

GRANT SELECT ON settlement.payouts TO passripple_api;

-- ── Payout deadline and actions ──────────────────────────────────────────────
-- Computes the payout deadline for an event: ends_at + claims window (24 hours by default),
-- then the next Monday-Friday business day in America/Costa_Rica at 09:00 local time.
-- Rule: if (ends_at + p_claims_window) in America/Costa_Rica already falls on a weekday
-- (Monday-Friday) at or before 09:00 local, that same day at 09:00 is used; otherwise move
-- to the next calendar day and advance past Saturday/Sunday to Monday at 09:00 local.
CREATE FUNCTION settlement.payout_due_at(
  p_event_id      uuid,
  p_claims_window interval DEFAULT interval '24 hours'
) RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_ends_at timestamptz;
  v_local   timestamp;
  v_day     date;
BEGIN
  SELECT e.ends_at INTO v_ends_at FROM events.events e WHERE e.id = p_event_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'event % not found', p_event_id USING ERRCODE = 'no_data_found';
  END IF;

  v_local := (v_ends_at + coalesce(p_claims_window, interval '24 hours'))
             AT TIME ZONE 'America/Costa_Rica';
  v_day := v_local::date;
  IF v_local > v_day + time '09:00' THEN
    v_day := v_day + 1;
  END IF;
  IF extract(isodow FROM v_day) = 6 THEN
    v_day := v_day + 2;
  ELSIF extract(isodow FROM v_day) = 7 THEN
    v_day := v_day + 1;
  END IF;

  RETURN (v_day + time '09:00') AT TIME ZONE 'America/Costa_Rica';
END
$$;

-- Records the SINPE transfer that settles an event. Only an administrator may call it, and
-- only once the event has ended and its 24-hour claims window has closed. Inserts the
-- negative 'payout' ledger entry (guarded by I9) and the payout record in one transaction.
CREATE FUNCTION settlement.record_payout(
  p_event_id   uuid,
  p_amount_crc integer,
  p_sinpe_ref  text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_ends_at   timestamptz;
  v_due_at    timestamptz;
  v_payout_id uuid;
BEGIN
  IF app.actor_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'only an administrator records payouts' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_amount_crc IS NULL OR p_amount_crc <= 0 THEN
    RAISE EXCEPTION 'payout amount must be positive' USING ERRCODE = 'check_violation';
  END IF;

  SELECT e.ends_at INTO v_ends_at FROM events.events e WHERE e.id = p_event_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'event % not found', p_event_id USING ERRCODE = 'no_data_found';
  END IF;
  IF now() < v_ends_at + interval '24 hours' THEN
    RAISE EXCEPTION 'event % cannot be paid out before its 24-hour claims window closes', p_event_id
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;

  v_due_at := settlement.payout_due_at(p_event_id);

  INSERT INTO settlement.ledger_entries (event_id, kind, amount_crc, reference, created_by)
  VALUES (p_event_id, 'payout', -p_amount_crc, p_sinpe_ref, app.actor_id());

  INSERT INTO settlement.payouts (event_id, amount_crc, sinpe_ref, due_at, created_by)
  VALUES (p_event_id, p_amount_crc, p_sinpe_ref, v_due_at, app.actor_id())
  RETURNING id INTO v_payout_id;

  RETURN v_payout_id;
END
$$;

-- Marks an event's payout as received by an organizer of the event's organization.
CREATE FUNCTION settlement.confirm_payout(p_event_id uuid)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_payout       settlement.payouts;
  v_confirmed_at timestamptz;
BEGIN
  IF NOT coalesce(app.actor_role() = 'organizer' AND EXISTS (
    SELECT 1 FROM events.events e
     WHERE e.id = p_event_id AND e.org_id = app.org_id()
  ), false) THEN
    RAISE EXCEPTION 'event % is not available to this actor', p_event_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_payout FROM settlement.payouts p WHERE p.event_id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'event % has no recorded payout', p_event_id
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF v_payout.confirmed_at IS NOT NULL THEN
    RAISE EXCEPTION 'payout for event % was already confirmed', p_event_id
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;

  UPDATE settlement.payouts
     SET confirmed_at = now()
   WHERE id = v_payout.id
  RETURNING confirmed_at INTO v_confirmed_at;

  RETURN v_confirmed_at;
END
$$;

-- ── Statements and platform totals ───────────────────────────────────────────
-- Settlement statement for an event. Fee, fee tax, refunds and paid_out are reported as
-- positive magnitudes; balance excludes door_sale; municipal_tax is informational, rounded
-- to the nearest colon on (collected - fee - fee_tax) * tax_rate_bps / 10000.
CREATE FUNCTION settlement.statement(p_event_id uuid)
RETURNS TABLE (
  collected_crc       integer,
  fee_crc             integer,
  fee_tax_crc         integer,
  refunds_crc         integer,
  adjustments_crc     integer,
  paid_out_crc        integer,
  balance_crc         integer,
  due_at              timestamptz,
  overdue             boolean,
  municipal_tax_crc   integer,
  payout_confirmed_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_org_id       uuid;
  v_tax_rate_bps integer;
  v_collected    integer;
  v_fee          integer;
  v_fee_tax      integer;
  v_refunds      integer;
  v_adjustments  integer;
  v_paid_out     integer;
  v_balance      integer;
  v_payout       settlement.payouts;
  v_due_at       timestamptz;
BEGIN
  SELECT e.org_id, j.tax_rate_bps
    INTO v_org_id, v_tax_rate_bps
    FROM events.events e
    JOIN jurisdictions.jurisdictions j ON j.canton_code = e.canton_code
   WHERE e.id = p_event_id;

  IF NOT FOUND
     OR NOT coalesce(app.actor_role() = 'admin'
                     OR (app.actor_role() = 'organizer' AND v_org_id = app.org_id()), false) THEN
    RAISE EXCEPTION 'event % is not available to this actor', p_event_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT coalesce(sum(le.amount_crc) FILTER (WHERE le.kind = 'payment_in'), 0)::integer,
         coalesce(-sum(le.amount_crc) FILTER (WHERE le.kind = 'fee'), 0)::integer,
         coalesce(-sum(le.amount_crc) FILTER (WHERE le.kind = 'fee_tax'), 0)::integer,
         coalesce(-sum(le.amount_crc) FILTER (WHERE le.kind = 'refund'), 0)::integer,
         coalesce(sum(le.amount_crc) FILTER (WHERE le.kind = 'adjustment'), 0)::integer,
         coalesce(-sum(le.amount_crc) FILTER (WHERE le.kind = 'payout'), 0)::integer,
         coalesce(sum(le.amount_crc) FILTER (WHERE le.kind <> 'door_sale'), 0)::integer
    INTO v_collected, v_fee, v_fee_tax, v_refunds, v_adjustments, v_paid_out, v_balance
    FROM settlement.ledger_entries le
   WHERE le.event_id = p_event_id;

  SELECT * INTO v_payout FROM settlement.payouts p WHERE p.event_id = p_event_id;
  v_due_at := coalesce(v_payout.due_at, settlement.payout_due_at(p_event_id));

  RETURN QUERY
    SELECT v_collected,
           v_fee,
           v_fee_tax,
           v_refunds,
           v_adjustments,
           v_paid_out,
           v_balance,
           v_due_at,
           -- Overdue only when there is money to pay out, as in platform_totals.
           (v_payout.id IS NULL AND now() > v_due_at AND v_balance > 0),
           round((v_collected - v_fee - v_fee_tax)::numeric * v_tax_rate_bps / 10000)::integer,
           v_payout.confirmed_at;
END
$$;

-- Platform-wide settlement figures for administrators (ADR 0039, decision 7):
--   custody_crc    = money physically in the collection account: SUM over all events of
--                    amount_crc for kinds payment_in, refund, adjustment and payout, MINUS
--                    the fee + fee_tax magnitudes of events that have a payout row (that
--                    commission was moved to the platform's own account at payout).
--   own_income_crc = SUM of fee + fee_tax magnitudes of events that have a payout row.
--   overdue_events = count of events with no payout row whose payout_due_at has passed and
--                    that have a positive ledger balance awaiting payout.
CREATE FUNCTION settlement.platform_totals()
RETURNS TABLE (
  custody_crc    bigint,
  own_income_crc bigint,
  overdue_events integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF app.actor_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'only an administrator reads platform totals'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
    SELECT
      (
        coalesce((
          SELECT sum(le.amount_crc)::bigint
            FROM settlement.ledger_entries le
           WHERE le.kind IN ('payment_in', 'refund', 'adjustment', 'payout')
        ), 0)
        -
        coalesce((
          SELECT sum(-le.amount_crc)::bigint
            FROM settlement.ledger_entries le
           WHERE le.kind IN ('fee', 'fee_tax')
             AND EXISTS (SELECT 1 FROM settlement.payouts p WHERE p.event_id = le.event_id)
        ), 0)
      ) AS custody_crc,
      coalesce((
        SELECT sum(-le.amount_crc)::bigint
          FROM settlement.ledger_entries le
         WHERE le.kind IN ('fee', 'fee_tax')
           AND EXISTS (SELECT 1 FROM settlement.payouts p WHERE p.event_id = le.event_id)
      ), 0) AS own_income_crc,
      (
        SELECT count(*)::integer
          FROM events.events e
         WHERE NOT EXISTS (SELECT 1 FROM settlement.payouts p WHERE p.event_id = e.id)
           AND now() > settlement.payout_due_at(e.id)
           AND (
             SELECT coalesce(sum(le.amount_crc), 0)
               FROM settlement.ledger_entries le
              WHERE le.event_id = e.id AND le.kind <> 'door_sale'
           ) > 0
      ) AS overdue_events;
END
$$;

GRANT EXECUTE ON FUNCTION settlement.record_sale(uuid, uuid, uuid, uuid, integer, text) TO passripple_api;
GRANT EXECUTE ON FUNCTION settlement.payout_due_at(uuid, interval) TO passripple_api;
GRANT EXECUTE ON FUNCTION settlement.record_payout(uuid, integer, text) TO passripple_api;
GRANT EXECUTE ON FUNCTION settlement.confirm_payout(uuid) TO passripple_api;
GRANT EXECUTE ON FUNCTION settlement.statement(uuid) TO passripple_api;
GRANT EXECUTE ON FUNCTION settlement.platform_totals() TO passripple_api;
