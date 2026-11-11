-- Named tickets (design 7.1): whether each ticket of the event carries its attendee's name
-- and document. 18+ events always do. 12+ events do by default, and the organizer may turn
-- it off only if the platform allows it (an owner's decision, kept as this default rather
-- than as a rule). All-ages events may opt in.

ALTER TABLE events.events
  ADD COLUMN named_tickets boolean NOT NULL DEFAULT false;

-- A new 12+ or 18+ event, or one whose rating rises, starts named.
CREATE FUNCTION events.default_named_tickets()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF NEW.age_rating <> 'all'
     AND (TG_OP = 'INSERT' OR OLD.age_rating IS DISTINCT FROM NEW.age_rating) THEN
    NEW.named_tickets := true;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER events_default_named_tickets BEFORE INSERT OR UPDATE ON events.events
  FOR EACH ROW EXECUTE FUNCTION events.default_named_tickets();

UPDATE events.events SET named_tickets = true WHERE age_rating <> 'all';

ALTER TABLE events.events
  ADD CONSTRAINT events_adults_named CHECK (age_rating <> '18plus' OR named_tickets);

GRANT INSERT (named_tickets), UPDATE (named_tickets) ON events.events TO passripple_api;
