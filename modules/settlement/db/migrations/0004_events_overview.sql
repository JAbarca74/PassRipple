-- The list the settlement screens start from (Phase 4): one row per event with its money.
-- An organizer sees their organization's events; an administrator sees every event that
-- has moved money, so the ones owed a payout stand out. Figures follow settlement.statement:
-- collected is the money in, balance is what is still owed (door sales never count).

CREATE FUNCTION settlement.events_overview()
RETURNS TABLE (
  event_id            uuid,
  org_id              uuid,
  name                text,
  starts_at           timestamptz,
  ends_at             timestamptz,
  collected_crc       integer,
  balance_crc         integer,
  due_at              timestamptz,
  payout_paid_at      timestamptz,
  payout_confirmed_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_role text := app.actor_role();
  v_org  uuid := app.org_id();
BEGIN
  IF v_role IS DISTINCT FROM 'admin' AND v_role IS DISTINCT FROM 'organizer' THEN
    RAISE EXCEPTION 'only organizers and administrators read settlements'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
    SELECT e.id,
           e.org_id,
           e.name,
           e.starts_at,
           e.ends_at,
           coalesce(m.collected, 0)::integer,
           coalesce(m.balance, 0)::integer,
           coalesce(p.due_at, settlement.payout_due_at(e.id)),
           p.paid_at,
           p.confirmed_at
      FROM events.events e
      LEFT JOIN LATERAL (
        SELECT sum(le.amount_crc) FILTER (WHERE le.kind = 'payment_in') AS collected,
               sum(le.amount_crc) FILTER (WHERE le.kind <> 'door_sale') AS balance,
               count(*) AS entries
          FROM settlement.ledger_entries le
         WHERE le.event_id = e.id
      ) m ON true
      LEFT JOIN settlement.payouts p ON p.event_id = e.id
     WHERE (v_role = 'organizer' AND e.org_id = v_org)
        OR (v_role = 'admin' AND m.entries > 0)
     ORDER BY e.ends_at DESC, e.id;
END
$$;

REVOKE ALL ON FUNCTION settlement.events_overview() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION settlement.events_overview() TO passripple_api;
