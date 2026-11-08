-- The buyer's news preference (design 14.4, 14.7): accepted or refused at checkout, and
-- changeable later from the wallet. Consents are append-only and name the order, never the
-- contact (privacy 0002), so a change is a new 'marketing' consent on every order of the
-- same contact: the choice belongs to the person, not to one purchase. The order's token
-- proves who asks, as everywhere in the wallet.

-- The orders that share the contact of the token's order, the token's own included. An
-- erased order has no contact and is never among them.
CREATE FUNCTION orders.contact_orders(p_access_token text)
RETURNS TABLE (order_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT o.id
    FROM orders.token_access(p_access_token) a
    JOIN orders.orders mine ON mine.id = a.order_id
    JOIN orders.orders o
      ON (mine.contact_email IS NOT NULL AND o.contact_email = mine.contact_email)
      OR (mine.contact_email IS NULL AND mine.contact_phone IS NOT NULL
          AND o.contact_email IS NULL AND o.contact_phone = mine.contact_phone)
   ORDER BY o.created_at, o.id;
$$;

-- The latest news choice recorded for any of those orders, or NULL when there is none.
CREATE FUNCTION orders.marketing_preference(p_access_token text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT k.granted
    FROM orders.contact_orders(p_access_token) c
    JOIN privacy.consents k ON k.subject_id = c.order_id AND k.purpose = 'marketing'
   ORDER BY k.created_at DESC, k.id DESC
   LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION orders.contact_orders(text) TO passripple_api;
GRANT EXECUTE ON FUNCTION orders.marketing_preference(text) TO passripple_api;
