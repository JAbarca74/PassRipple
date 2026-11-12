-- Fee totals for an order, read by settlement when booking a confirmed payment (ADR 0039).
-- Sums the frozen per-ticket service fee and fee tax across the order's lines (I5).

CREATE FUNCTION orders.order_fee_totals(p_order_id uuid)
RETURNS TABLE (
  event_id    uuid,
  status      text,
  amount_crc  integer,
  fee_crc     integer,
  fee_tax_crc integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT o.event_id,
         o.status,
         o.amount_crc,
         coalesce(sum(i.unit_fee_crc * i.quantity), 0)::integer,
         coalesce(sum(i.unit_fee_tax_crc * i.quantity), 0)::integer
    FROM orders.orders o
    LEFT JOIN orders.order_items i ON i.order_id = o.id
   WHERE o.id = p_order_id
   GROUP BY o.id, o.event_id, o.status, o.amount_crc;
$$;

REVOKE ALL ON FUNCTION orders.order_fee_totals(uuid) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'passripple_owner_settlement') THEN
    GRANT EXECUTE ON FUNCTION orders.order_fee_totals(uuid) TO passripple_owner_settlement;
  END IF;
END
$$;
