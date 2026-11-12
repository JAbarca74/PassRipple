-- Which transaction last changed each ticket, so gate manifests can send only what changed
-- (design 8.3: new tickets, voids and rebindings). The cursor a device keeps is the oldest
-- transaction still running when its manifest was read (manifest.cursor()); every change it
-- has not seen was made by that transaction or a later one, so asking for change_xid >=
-- cursor misses nothing, even with concurrent writers, which a timestamp cannot promise.

ALTER TABLE ticketing.tickets ADD COLUMN change_xid xid8 NOT NULL DEFAULT pg_current_xact_id();

-- Stamped on every insert and update, whatever the caller passes.
CREATE FUNCTION ticketing.stamp_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  NEW.change_xid := pg_current_xact_id();
  RETURN NEW;
END
$$;

CREATE TRIGGER tickets_stamp_change BEFORE INSERT OR UPDATE ON ticketing.tickets
  FOR EACH ROW EXECUTE FUNCTION ticketing.stamp_change();

CREATE INDEX tickets_event_change_idx ON ticketing.tickets (event_id, change_xid);
