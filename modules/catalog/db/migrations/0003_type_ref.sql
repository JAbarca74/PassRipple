-- A short number for each ticket type within its event, carried by every credential as
-- its 2-byte type_ref (ADR 0013, ADR 0016). It is assigned on insert and never changes:
-- credentials already shown at the gate would otherwise point to another type.

ALTER TABLE catalog.ticket_types ADD COLUMN ref integer;

UPDATE catalog.ticket_types t
   SET ref = n.ref
  FROM (SELECT id, row_number() OVER (PARTITION BY event_id ORDER BY created_at, id) AS ref
          FROM catalog.ticket_types) n
 WHERE n.id = t.id;

ALTER TABLE catalog.ticket_types
  ALTER COLUMN ref SET NOT NULL,
  ADD CONSTRAINT ticket_types_ref_range CHECK (ref BETWEEN 1 AND 65535),
  ADD CONSTRAINT ticket_types_event_ref_key UNIQUE (event_id, ref);

-- The next number of the event, whatever the caller passes. Types are created rarely, so
-- one lock per event is enough to keep two concurrent inserts from taking the same number.
-- SECURITY DEFINER so the count covers every type of the event, not only those the
-- caller can see.
CREATE FUNCTION catalog.assign_type_ref()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('catalog.ticket_types:' || NEW.event_id::text, 0));
  SELECT coalesce(max(t.ref), 0) + 1 INTO NEW.ref
    FROM catalog.ticket_types t WHERE t.event_id = NEW.event_id;
  RETURN NEW;
END
$$;

CREATE FUNCTION catalog.keep_type_ref()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF (NEW.ref, NEW.event_id) IS DISTINCT FROM (OLD.ref, OLD.event_id) THEN
    RAISE EXCEPTION 'ticket type %: its event and number never change', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER ticket_types_assign_ref BEFORE INSERT ON catalog.ticket_types
  FOR EACH ROW EXECUTE FUNCTION catalog.assign_type_ref();
CREATE TRIGGER ticket_types_keep_ref BEFORE UPDATE ON catalog.ticket_types
  FOR EACH ROW EXECUTE FUNCTION catalog.keep_type_ref();
