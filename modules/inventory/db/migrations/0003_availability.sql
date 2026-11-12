-- What a buyer may know about availability before holding (design 9.3): the capacity left
-- of an event on sale, read from the counter. Buyers cannot read the counter itself (its
-- policy is for organizers), and the exact answer is decided only by inventory.hold. The
-- API turns it into a coarse level and caches it for a few seconds.
CREATE FUNCTION inventory.availability(p_event_id uuid)
RETURNS TABLE (remaining integer, permitted_capacity integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT c.permitted_capacity - c.committed, c.permitted_capacity
    FROM inventory.event_capacity c JOIN events.events e ON e.id = c.event_id
   WHERE c.event_id = p_event_id AND e.status = 'on_sale';
$$;

GRANT EXECUTE ON FUNCTION inventory.availability(uuid) TO passripple_api;
