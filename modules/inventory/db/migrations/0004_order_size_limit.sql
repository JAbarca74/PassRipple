-- No hold takes more tickets than the event allows per order (design 9.3, point 5). Checked
-- on the hold itself, so every path that reserves capacity obeys it. SQLSTATE PR413 maps
-- to 400 too_many_tickets in the API.

CREATE FUNCTION inventory.check_order_size()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_max integer;
BEGIN
  SELECT e.max_tickets_per_order INTO v_max FROM events.events e WHERE e.id = NEW.event_id;
  IF NEW.quantity > v_max THEN
    RAISE EXCEPTION 'an order of event % takes at most % tickets', NEW.event_id, v_max
      USING ERRCODE = 'PR413';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER holds_order_size BEFORE INSERT ON inventory.holds
  FOR EACH ROW EXECUTE FUNCTION inventory.check_order_size();
