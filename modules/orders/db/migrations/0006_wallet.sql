-- The buyer's wallet (design 6.6, ADR 0030 and 0032). The order's access token is the
-- buyer's only credential; it reaches its own order's tickets and nothing else. orders is a
-- level 3 module and may read ticketing (level 2), so the token is checked and the tickets
-- read in one statement: no caller passes an order id.

-- Further tokens of an order, besides the one it was created with. Recovery (ADR 0036)
-- issues one to a new device; it may rebind the order's tickets to that device once, before
-- rebind_until. Only the SHA-256 of a token is stored.
CREATE TABLE orders.order_tokens (
  token_hash     bytea       PRIMARY KEY CHECK (length(token_hash) = 32),
  order_id       uuid        NOT NULL REFERENCES orders.orders (id),
  kind           text        NOT NULL CHECK (kind IN ('recovery')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  rebind_until   timestamptz NOT NULL,
  rebind_used_at timestamptz
);
CREATE INDEX order_tokens_order_idx ON orders.order_tokens (order_id);

ALTER TABLE orders.order_tokens ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
CREATE POLICY order_tokens_module_read ON orders.order_tokens FOR SELECT USING (app.is_module_role());
CREATE POLICY order_tokens_module_write ON orders.order_tokens TO passripple_owner_orders
  USING (true) WITH CHECK (true);

-- The order behind a token, and whether this token may rebind tickets bound to another
-- device right now. Internal.
CREATE FUNCTION orders.token_access(p_access_token text)
RETURNS TABLE (order_id uuid, can_rebind boolean)
LANGUAGE sql
STABLE
SET search_path = pg_catalog
AS $$
  SELECT o.id, false
    FROM orders.orders o
   WHERE o.access_token_hash = sha256(convert_to(p_access_token, 'UTF8'))
  UNION ALL
  SELECT t.order_id, t.rebind_used_at IS NULL AND t.rebind_until > now()
    FROM orders.order_tokens t
   WHERE t.token_hash = sha256(convert_to(p_access_token, 'UTF8'));
$$;

-- The wallet's view of its order: the purchase token or a recovery token.
CREATE FUNCTION orders.wallet_access(p_access_token text)
RETURNS TABLE (order_id uuid, status text, pay_code text, amount_crc integer,
               expires_at timestamptz, can_rebind boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT o.id, o.status, o.pay_code, o.amount_crc, o.expires_at, a.can_rebind
    FROM orders.token_access(p_access_token) a JOIN orders.orders o ON o.id = a.order_id;
$$;

-- The tickets of the token's order, with what a certificate and the wallet need from
-- ticketing, catalog and events.
CREATE FUNCTION orders.wallet_tickets(p_access_token text)
RETURNS TABLE (ticket_id uuid, event_id uuid, event_name text, venue_name text,
               starts_at timestamptz, age_rating text, type_name text, type_ref integer,
               entry_mode text, status text, holder_pubkey bytea, key_version smallint,
               code_human text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT t.id, t.event_id, e.name, e.venue_name, e.starts_at, e.age_rating, tt.name,
         tt.ref::integer, t.entry_mode, t.status, t.holder_pubkey, t.key_version, t.code_human
    FROM orders.token_access(p_access_token) a
    JOIN ticketing.tickets t ON t.order_id = a.order_id AND t.origin = 'sale'
    JOIN catalog.ticket_types tt ON tt.id = t.ticket_type_id
    JOIN events.events e ON e.id = t.event_id
   ORDER BY tt.ref, t.created_at, t.id;
$$;

-- A recovery token used its one rebinding. Returns whether it could.
CREATE FUNCTION orders.consume_rebind(p_access_token text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF app.actor_role() IS DISTINCT FROM 'system' THEN
    RAISE EXCEPTION 'only the system rebinds tickets' USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE orders.order_tokens SET rebind_used_at = now()
   WHERE token_hash = sha256(convert_to(p_access_token, 'UTF8'))
     AND rebind_used_at IS NULL AND rebind_until > now();
  RETURN FOUND;
END
$$;

GRANT EXECUTE ON FUNCTION orders.wallet_access(text) TO passripple_api;
GRANT EXECUTE ON FUNCTION orders.wallet_tickets(text) TO passripple_api;
GRANT EXECUTE ON FUNCTION orders.consume_rebind(text) TO passripple_api;
