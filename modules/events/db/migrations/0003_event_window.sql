-- The end of the event's window. Gate manifests expire with it, and the gate app deletes
-- the event's data from staff phones once its queue is synced (design 8.3, 11.2). An event
-- created without an end gets one twelve hours after it starts.

ALTER TABLE events.events ADD COLUMN ends_at timestamptz;

UPDATE events.events SET ends_at = starts_at + interval '12 hours' WHERE ends_at IS NULL;

CREATE FUNCTION events.default_ends_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF NEW.ends_at IS NULL THEN
    NEW.ends_at := NEW.starts_at + interval '12 hours';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER events_default_ends_at BEFORE INSERT OR UPDATE ON events.events
  FOR EACH ROW EXECUTE FUNCTION events.default_ends_at();

ALTER TABLE events.events
  ALTER COLUMN ends_at SET NOT NULL,
  ADD CONSTRAINT events_window CHECK (ends_at > starts_at);

GRANT INSERT (ends_at), UPDATE (ends_at) ON events.events TO passripple_api;
