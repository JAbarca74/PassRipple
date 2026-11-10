-- The organizer's live dashboard (Phase 4, design 8.10): counters of an event and the state
-- of its gate devices, read from the modules that own the facts. Nothing is stored here
-- yet: at the volumes of a single event the counters are cheap to compute on demand.
--
-- What the server cannot know is left out: operations still queued on a phone appear only
-- when the phone uploads them, so a device shows its last synchronization, not a guess.

-- Who may read an event's dashboard: an administrator, or an organizer of its organization.
CREATE FUNCTION reporting.assert_event_reader(p_event_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF NOT coalesce(app.actor_role() = 'admin' OR (app.actor_role() = 'organizer' AND EXISTS (
       SELECT 1 FROM events.events e WHERE e.id = p_event_id AND e.org_id = app.org_id())), false) THEN
    RAISE EXCEPTION 'event % is not available to this actor', p_event_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;
END
$$;

-- One row of counters for the event.
--   committed: what counts against the permitted capacity (sales, holds, courtesies, door).
--   sold: tickets bought online and not voided. courtesies and door_sales likewise.
--   admitted: distinct tickets let in; duplicates: scans refused as already used.
--   sales_by_hour: tickets sold online per hour over the last 12 hours, oldest first, in
--   Costa Rica time, with the empty hours included so a chart needs no gap filling.
CREATE FUNCTION reporting.event_counters(p_event_id uuid)
RETURNS TABLE (
  permitted_capacity integer,
  committed          integer,
  sold               integer,
  courtesies         integer,
  door_sales         integer,
  admitted           integer,
  duplicates         integer,
  incidents          integer,
  sales_by_hour      jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_now timestamptz := now();
BEGIN
  PERFORM reporting.assert_event_reader(p_event_id);

  RETURN QUERY
    SELECT coalesce(c.permitted_capacity, e.permitted_capacity),
           coalesce(c.committed, 0),
           t.sold,
           t.courtesies,
           t.door_sales,
           r.admitted,
           r.duplicates,
           (SELECT count(*)::integer
              FROM redemption.incidents i
              JOIN staff.staff_devices d ON d.id = i.device_id
             WHERE d.event_id = p_event_id),
           (SELECT jsonb_agg(jsonb_build_object('hour', h.hour, 'tickets', coalesce(s.tickets, 0))
                             ORDER BY h.hour)
              FROM generate_series(
                     date_trunc('hour', v_now AT TIME ZONE 'America/Costa_Rica') - interval '11 hours',
                     date_trunc('hour', v_now AT TIME ZONE 'America/Costa_Rica'),
                     interval '1 hour') AS h(hour)
              LEFT JOIN (
                SELECT date_trunc('hour', tk.created_at AT TIME ZONE 'America/Costa_Rica') AS hour,
                       count(*)::integer AS tickets
                  FROM ticketing.tickets tk
                 WHERE tk.event_id = p_event_id AND tk.origin = 'sale' AND tk.status <> 'void'
                   AND tk.created_at > v_now - interval '12 hours'
                 GROUP BY 1
              ) s ON s.hour = h.hour)
      FROM events.events e
      LEFT JOIN inventory.event_capacity c ON c.event_id = e.id
      CROSS JOIN LATERAL (
        SELECT count(*) FILTER (WHERE tk.origin = 'sale')::integer AS sold,
               count(*) FILTER (WHERE tk.origin = 'courtesy')::integer AS courtesies,
               count(*) FILTER (WHERE tk.origin = 'door_sale')::integer AS door_sales
          FROM ticketing.tickets tk
         WHERE tk.event_id = e.id AND tk.status IN ('issued', 'bound')
      ) t
      CROSS JOIN LATERAL (
        SELECT count(DISTINCT rd.ticket_id) FILTER (WHERE rd.outcome = 'admitted')::integer AS admitted,
               count(*) FILTER (WHERE rd.outcome = 'duplicate')::integer AS duplicates
          FROM redemption.redemptions rd
          JOIN ticketing.tickets tk ON tk.id = rd.ticket_id
         WHERE tk.event_id = e.id
      ) r
     WHERE e.id = p_event_id;
END
$$;

-- One row per staff device of the event, enrolled first. last_sync_at is the last time the
-- server received anything from it (a scan or an incident); NULL when nothing arrived yet.
CREATE FUNCTION reporting.event_devices(p_event_id uuid)
RETURNS TABLE (
  device_id    uuid,
  role         text,
  zone         text,
  enrolled_at  timestamptz,
  valid_until  timestamptz,
  revoked_at   timestamptz,
  last_sync_at timestamptz,
  admitted     integer,
  incidents    integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  PERFORM reporting.assert_event_reader(p_event_id);

  RETURN QUERY
    SELECT d.id,
           d.role,
           d.zone,
           d.created_at,
           d.valid_until,
           d.revoked_at,
           greatest(r.last_scan, i.last_incident),
           coalesce(r.admitted, 0),
           coalesce(i.incidents, 0)
      FROM staff.staff_devices d
      LEFT JOIN LATERAL (
        SELECT max(rd.synced_at) AS last_scan,
               count(*) FILTER (WHERE rd.outcome = 'admitted')::integer AS admitted
          FROM redemption.redemptions rd
         WHERE rd.device_id = d.id
      ) r ON true
      LEFT JOIN LATERAL (
        SELECT max(inc.created_at) FILTER (WHERE inc.source = 'device') AS last_incident,
               count(*)::integer AS incidents
          FROM redemption.incidents inc
         WHERE inc.device_id = d.id
      ) i ON true
     WHERE d.event_id = p_event_id
     ORDER BY d.created_at, d.id;
END
$$;

REVOKE ALL ON FUNCTION reporting.assert_event_reader(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION reporting.event_counters(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION reporting.event_devices(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reporting.event_counters(uuid) TO passripple_api;
GRANT EXECUTE ON FUNCTION reporting.event_devices(uuid) TO passripple_api;
GRANT USAGE ON SCHEMA reporting TO passripple_api;
