-- The organizer's export of an event (Phase 10): one row per ticket, to open in a spreadsheet
-- or hand to an accountant. It holds no personal data: no buyer contact, no attendee name or
-- document. The ticket is identified by the last four characters of its human code, which is
-- what the gate staff and the buyer already read to each other, and by its position in the
-- event's own numbering.

CREATE FUNCTION reporting.event_export(p_event_id uuid)
RETURNS TABLE (
  seq         integer,
  code_tail   text,
  ticket_type text,
  zone        text,
  origin      text,
  status      text,
  price_crc   integer,
  issued_at   timestamptz,
  admitted_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  PERFORM reporting.assert_event_reader(p_event_id);
  RETURN QUERY
    SELECT (row_number() OVER (ORDER BY t.created_at, t.id))::integer,
           right(t.code_human, 4),
           tt.name,
           tt.zone,
           t.origin,
           t.status,
           CASE WHEN t.origin = 'courtesy' THEN 0 ELSE tt.price_crc END,
           t.created_at,
           (SELECT min(r.synced_at) FROM redemption.redemptions r
             WHERE r.ticket_id = t.id AND r.outcome = 'admitted')
      FROM ticketing.tickets t
      JOIN catalog.ticket_types tt ON tt.id = t.ticket_type_id
     WHERE t.event_id = p_event_id AND t.status <> 'unsold'
     ORDER BY t.created_at, t.id;
END
$$;

REVOKE ALL ON FUNCTION reporting.event_export(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reporting.event_export(uuid) TO passripple_api;
