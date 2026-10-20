-- Recovery of a buyer's tickets on a new device (design 6.6, ADR 0036), and the same proof
-- of identity for erasing their data (14.7): a six-digit code sent to the order's email.
-- The database stores only an HMAC of the code, keyed with a Worker secret and bound to the
-- address; the Worker compares it in constant time. Five codes per address in 15 minutes,
-- five attempts per code, ten minutes of life, one use.

CREATE TABLE orders.contact_codes (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_email text        NOT NULL CHECK (contact_email ~ '^[^@[:space:]]+@[^@[:space:]]+$'),
  purpose       text        NOT NULL CHECK (purpose IN ('recovery', 'erasure')),
  code_hash     bytea       NOT NULL CHECK (length(code_hash) = 32),
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  attempts      integer     NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  used_at       timestamptz,
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '30 minutes')
);
CREATE INDEX contact_codes_email_idx ON orders.contact_codes (contact_email, created_at);

ALTER TABLE orders.contact_codes ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
CREATE POLICY contact_codes_module_read ON orders.contact_codes FOR SELECT USING (app.is_module_role());
CREATE POLICY contact_codes_module_write ON orders.contact_codes TO passripple_owner_orders
  USING (true) WITH CHECK (true);

-- Records a code just drawn by the Worker. Returns whether the address has orders: the
-- Worker sends the mail only then, and answers the same either way. A sixth code in 15
-- minutes raises PR429.
CREATE FUNCTION orders.request_contact_code(
  p_email text, p_purpose text, p_code_hash bytea, p_ttl interval
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF app.actor_role() IS DISTINCT FROM 'system' THEN
    RAISE EXCEPTION 'only the system records contact codes' USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- Serializes requests for one address, so the limit holds under concurrency.
  PERFORM pg_advisory_xact_lock(hashtextextended('orders.contact_codes/' || p_email, 0));
  IF (SELECT count(*) FROM orders.contact_codes
       WHERE contact_email = p_email AND created_at > now() - interval '15 minutes') >= 5 THEN
    RAISE EXCEPTION 'too many codes for this address' USING ERRCODE = 'PR429';
  END IF;
  INSERT INTO orders.contact_codes (contact_email, purpose, code_hash, expires_at)
  VALUES (p_email, p_purpose, p_code_hash, now() + p_ttl);
  RETURN EXISTS (SELECT 1 FROM orders.orders o WHERE o.contact_email = p_email);
END
$$;

-- The newest live code of an address for a purpose, and one more attempt counted on it,
-- for the Worker to compare in constant time. Nothing when there is no live code or its
-- attempts are spent. The attempt counts even if the comparison then fails.
CREATE FUNCTION orders.contact_code_challenge(p_email text, p_purpose text)
RETURNS TABLE (code_id uuid, code_hash bytea)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
#variable_conflict use_column
DECLARE
  v_id uuid;
BEGIN
  IF app.actor_role() IS DISTINCT FROM 'system' THEN
    RAISE EXCEPTION 'only the system checks contact codes' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT c.id INTO v_id FROM orders.contact_codes c
   WHERE c.contact_email = p_email AND c.purpose = p_purpose AND c.used_at IS NULL
     AND c.expires_at > now() AND c.attempts < 5
   ORDER BY c.created_at DESC
   LIMIT 1
     FOR UPDATE;
  IF v_id IS NULL THEN
    RETURN;
  END IF;
  UPDATE orders.contact_codes c SET attempts = c.attempts + 1 WHERE c.id = v_id;
  RETURN QUERY SELECT c.id, c.code_hash FROM orders.contact_codes c WHERE c.id = v_id;
END
$$;

-- The code matched: it is used up. Returns false when it was used meanwhile.
CREATE FUNCTION orders.use_contact_code(p_code_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF app.actor_role() IS DISTINCT FROM 'system' THEN
    RAISE EXCEPTION 'only the system uses contact codes' USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE orders.contact_codes SET used_at = now()
   WHERE id = p_code_id AND used_at IS NULL AND expires_at > now();
  RETURN FOUND;
END
$$;

-- Recovery after a used code: one new token per paid order of the address, which may rebind
-- the order's tickets to the new device once within an hour. The Worker draws the token for
-- each order the first call lists. The code must have been used for recovery a moment ago.
CREATE FUNCTION orders.recoverable_orders(p_code_id uuid)
RETURNS TABLE (order_id uuid, pay_code text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
#variable_conflict use_column
BEGIN
  IF app.actor_role() IS DISTINCT FROM 'system' THEN
    RAISE EXCEPTION 'only the system recovers orders' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
    SELECT o.id, o.pay_code
      FROM orders.contact_codes c JOIN orders.orders o ON o.contact_email = c.contact_email
     WHERE c.id = p_code_id AND c.purpose = 'recovery' AND c.used_at > now() - interval '5 minutes'
       AND o.status = 'paid'
     ORDER BY o.created_at;
END
$$;

CREATE FUNCTION orders.add_recovery_token(p_code_id uuid, p_order_id uuid, p_token text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF app.actor_role() IS DISTINCT FROM 'system' THEN
    RAISE EXCEPTION 'only the system recovers orders' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_token IS NULL OR length(p_token) < 32 THEN
    RAISE EXCEPTION 'the token must have at least 32 characters' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM orders.recoverable_orders(p_code_id) r WHERE r.order_id = p_order_id) THEN
    RAISE EXCEPTION 'order % is not recoverable with this code', p_order_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  INSERT INTO orders.order_tokens (token_hash, order_id, kind, rebind_until)
  VALUES (sha256(convert_to(p_token, 'UTF8')), p_order_id, 'recovery', now() + interval '1 hour');
END
$$;

GRANT EXECUTE ON FUNCTION orders.request_contact_code(text, text, bytea, interval) TO passripple_api;
GRANT EXECUTE ON FUNCTION orders.contact_code_challenge(text, text) TO passripple_api;
GRANT EXECUTE ON FUNCTION orders.use_contact_code(uuid) TO passripple_api;
GRANT EXECUTE ON FUNCTION orders.recoverable_orders(uuid) TO passripple_api;
GRANT EXECUTE ON FUNCTION orders.add_recovery_token(uuid, uuid, text) TO passripple_api;
