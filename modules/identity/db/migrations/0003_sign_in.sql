-- Sign-in with a one-time code sent by email (design 3.2, 11.2), for staff, organizers and
-- inspectors. Buyers have no account. The Worker draws the code and the session token and
-- keeps them to itself: the database stores only their hashes, so a leaked table signs
-- nobody in. Codes are hashed with a keyed HMAC whose key lives in the Workers secrets,
-- because six digits are trivial to brute-force from a plain hash.
--
-- The email is the first personal data in identity. Erasing an account clears it
-- (identity.erase_user, design 14.7).

ALTER TABLE identity.users
  ADD COLUMN email text CHECK (email = lower(btrim(email)) AND email ~ '^[^@[:space:]]+@[^@[:space:]]+$'
                               AND length(email) <= 254);
CREATE UNIQUE INDEX users_email_key ON identity.users (email) WHERE email IS NOT NULL;

-- One row per code sent. Only the newest unused code of an address counts.
CREATE TABLE identity.sign_in_codes (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text        NOT NULL CHECK (email = lower(btrim(email))),
  -- HMAC-SHA256 of the code, keyed with a Workers secret and bound to the address.
  code_hash   bytea       NOT NULL CHECK (length(code_hash) = 32),
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  attempts    smallint    NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  consumed_at timestamptz,
  CHECK (expires_at > created_at)
);
CREATE INDEX sign_in_codes_email_idx ON identity.sign_in_codes (email, created_at DESC);

-- A signed-in person. The token is 32 random bytes held by the client; only its SHA-256
-- is stored.
CREATE TABLE identity.user_sessions (
  token_hash bytea       PRIMARY KEY CHECK (length(token_hash) = 32),
  user_id    uuid        NOT NULL REFERENCES identity.users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  ended_at   timestamptz,
  CHECK (expires_at > created_at)
);
CREATE INDEX user_sessions_user_idx ON identity.user_sessions (user_id);

-- ── Row Level Security ───────────────────────────────────────────────────────
-- Codes and sessions are reached only through the functions below: the API has no grant
-- on either table.
ALTER TABLE identity.sign_in_codes ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
ALTER TABLE identity.user_sessions ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;

CREATE POLICY sign_in_codes_module_read ON identity.sign_in_codes FOR SELECT USING (app.is_module_role());
CREATE POLICY sign_in_codes_module_write ON identity.sign_in_codes TO passripple_owner_identity
  USING (true) WITH CHECK (true);
CREATE POLICY user_sessions_module_read ON identity.user_sessions FOR SELECT USING (app.is_module_role());
CREATE POLICY user_sessions_module_write ON identity.user_sessions TO passripple_owner_identity
  USING (true) WITH CHECK (true);

-- ── Functions ────────────────────────────────────────────────────────────────
-- Records a code just sent to an address, as the system actor (nobody is signed in yet).
-- At most five codes per address in fifteen minutes; more raises PR429, which the API
-- answers with 429. Earlier unused codes of the address stop counting.
CREATE FUNCTION identity.request_sign_in(p_email text, p_code_hash bytea, p_ttl interval)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF app.actor_role() IS DISTINCT FROM 'system' THEN
    RAISE EXCEPTION 'only the system records sign-in codes' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_ttl IS NULL OR p_ttl <= interval '0' OR p_ttl > interval '30 minutes' THEN
    RAISE EXCEPTION 'a sign-in code lives between 0 and 30 minutes' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  -- Serializes requests for one address, so the limit below holds under concurrency.
  PERFORM pg_advisory_xact_lock(hashtextextended('identity.sign_in:' || p_email, 0));
  IF (SELECT count(*) FROM identity.sign_in_codes
       WHERE email = p_email AND created_at > now() - interval '15 minutes') >= 5 THEN
    RAISE EXCEPTION 'too many sign-in codes for this address' USING ERRCODE = 'PR429';
  END IF;
  UPDATE identity.sign_in_codes SET consumed_at = now()
   WHERE email = p_email AND consumed_at IS NULL;
  INSERT INTO identity.sign_in_codes (email, code_hash, expires_at)
  VALUES (p_email, p_code_hash, now() + p_ttl);
END
$$;

-- Checks a typed code and, if it matches, opens a session and returns the user, creating
-- the account on first sign-in. Returns NULL for a wrong, expired or used code, or a
-- disabled account, so the attempt counted on a wrong code is committed, not rolled back.
-- After five wrong attempts the code is dead.
CREATE FUNCTION identity.verify_sign_in(
  p_email text, p_code_hash bytea, p_token_hash bytea, p_session_ttl interval
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_code    identity.sign_in_codes;
  v_user_id uuid;
  v_disabled timestamptz;
BEGIN
  IF app.actor_role() IS DISTINCT FROM 'system' THEN
    RAISE EXCEPTION 'only the system verifies sign-in codes' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_session_ttl IS NULL OR p_session_ttl <= interval '0' OR p_session_ttl > interval '30 days' THEN
    RAISE EXCEPTION 'a session lives between 0 and 30 days' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT * INTO v_code FROM identity.sign_in_codes
   WHERE email = p_email AND consumed_at IS NULL
   ORDER BY created_at DESC LIMIT 1
     FOR UPDATE;
  IF NOT FOUND OR v_code.expires_at <= now() OR v_code.attempts >= 5 THEN
    RETURN NULL;
  END IF;
  IF v_code.code_hash IS DISTINCT FROM p_code_hash THEN
    UPDATE identity.sign_in_codes
       SET attempts = attempts + 1,
           consumed_at = CASE WHEN attempts + 1 >= 5 THEN now() END
     WHERE id = v_code.id;
    RETURN NULL;
  END IF;
  UPDATE identity.sign_in_codes SET consumed_at = now() WHERE id = v_code.id;

  SELECT id, disabled_at INTO v_user_id, v_disabled FROM identity.users WHERE email = p_email;
  IF NOT FOUND THEN
    INSERT INTO identity.users (email) VALUES (p_email) RETURNING id INTO v_user_id;
  ELSIF v_disabled IS NOT NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO identity.user_sessions (token_hash, user_id, expires_at)
  VALUES (p_token_hash, v_user_id, now() + p_session_ttl);
  RETURN v_user_id;
END
$$;

-- The user behind a session token, or NULL if the session is unknown, ended or expired, or
-- the account is disabled. Called before the actor is set: it is how the actor is found.
CREATE FUNCTION identity.authenticate_session(p_token_hash bytea)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT s.user_id
    FROM identity.user_sessions s JOIN identity.users u ON u.id = s.user_id
   WHERE s.token_hash = p_token_hash
     AND s.ended_at IS NULL AND s.expires_at > now() AND u.disabled_at IS NULL
$$;

-- Ends a session (sign-out). Ending it twice keeps the first time.
CREATE FUNCTION identity.end_session(p_token_hash bytea)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  UPDATE identity.user_sessions SET ended_at = coalesce(ended_at, now()) WHERE token_hash = p_token_hash
$$;

GRANT EXECUTE ON FUNCTION identity.request_sign_in(text, bytea, interval) TO passripple_api;
GRANT EXECUTE ON FUNCTION identity.verify_sign_in(text, bytea, bytea, interval) TO passripple_api;
GRANT EXECUTE ON FUNCTION identity.authenticate_session(bytea) TO passripple_api;
GRANT EXECUTE ON FUNCTION identity.end_session(bytea) TO passripple_api;
