-- One buyer cannot hoard capacity with many unpaid orders (design 9.3, point 5): a new
-- pending order is refused when the same email or phone already has the event's limit of
-- unpaid, unexpired orders for that event. A transaction lock per event and contact makes
-- two simultaneous orders of the same buyer queue, so neither slips past the count.
-- SQLSTATE PRBUY maps to 409 too_many_open_orders in the API; the order's hold is in the same
-- transaction and is undone with it.

CREATE FUNCTION orders.check_open_orders()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_max   integer;
  v_open  integer;
  v_email text := lower(NEW.contact_email);
BEGIN
  IF NEW.status <> 'pending' THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    NEW.event_id::text || '/' || coalesce(v_email, '') || '/' || coalesce(NEW.contact_phone, ''), 0));

  SELECT e.max_open_orders_per_buyer INTO v_max FROM events.events e WHERE e.id = NEW.event_id;
  SELECT count(*) INTO v_open
    FROM orders.orders o
   WHERE o.event_id = NEW.event_id
     AND o.status = 'pending'
     AND o.expires_at > now()
     AND ((v_email IS NOT NULL AND lower(o.contact_email) = v_email)
          OR (NEW.contact_phone IS NOT NULL AND o.contact_phone = NEW.contact_phone));
  IF v_open >= v_max THEN
    RAISE EXCEPTION 'this buyer already has % unpaid orders for event %', v_open, NEW.event_id
      USING ERRCODE = 'PRBUY';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER orders_open_orders_limit BEFORE INSERT ON orders.orders
  FOR EACH ROW EXECUTE FUNCTION orders.check_open_orders();

CREATE INDEX orders_pending_email_idx ON orders.orders (event_id, lower(contact_email))
  WHERE status = 'pending';
CREATE INDEX orders_pending_phone_idx ON orders.orders (event_id, contact_phone)
  WHERE status = 'pending';
