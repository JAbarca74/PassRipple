-- A receiver's optional email (design 6.6, owner's decision of 2026-11-08). Whoever claims a
-- transferred ticket may leave an email; with it they can recover the ticket on a new
-- phone, download what is kept about them and have the email forgotten, like a buyer.
-- Without it nothing changes: the ticket lives only on the phone that claimed it.
--
-- The email lives on the claim it was given with. A claim is "current" while it is the
-- ticket's latest one: once the receiver passes the ticket on, their email no longer
-- reaches it. Recovery replaces the receiver's token (the old phone's token stops working)
-- and allows one rebinding to a new device key within an hour. The proof that the person
-- owns the email is a contact code, which lives in orders; orders.recoverable_held checks
-- it and lists the claims, and the Worker calls ticketing.recover_held for each one.

ALTER TABLE ticketing.transfers
  ADD COLUMN holder_email text CHECK (holder_email ~ '^[^@[:space:]]+@[^@[:space:]]+$'),
  ADD COLUMN rebind_until timestamptz,
  ADD CONSTRAINT transfers_holder_email_claimed CHECK (holder_email IS NULL OR claimed_at IS NOT NULL),
  ADD CONSTRAINT transfers_rebind_claimed CHECK (rebind_until IS NULL OR claimed_at IS NOT NULL);
CREATE INDEX transfers_holder_email_idx ON ticketing.transfers (holder_email)
  WHERE holder_email IS NOT NULL;

-- Whether a claim is still the ticket's latest one.
CREATE FUNCTION ticketing.is_current_claim(p_transfer_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1 FROM ticketing.transfers x
     WHERE x.id = p_transfer_id AND x.claimed_at IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM ticketing.transfers y
                        WHERE y.ticket_id = x.ticket_id AND y.claimed_at > x.claimed_at));
$$;

-- claim_transfer with the receiver's optional email; without it, it claims as before.
DROP FUNCTION ticketing.claim_transfer(text, bytea, text);

CREATE FUNCTION ticketing.claim_transfer(
  p_offer_token text, p_holder_pubkey bytea, p_holder_token text, p_holder_email text DEFAULT NULL
) RETURNS smallint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_offer   ticketing.transfers;
  v_ticket  ticketing.tickets;
  v_starts  timestamptz;
  v_version smallint;
BEGIN
  IF app.actor_role() IS DISTINCT FROM 'system' THEN
    RAISE EXCEPTION 'only the system claims transfers' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_holder_token IS NULL OR length(p_holder_token) < 32 THEN
    RAISE EXCEPTION 'the holder token must have at least 32 characters' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO v_offer FROM ticketing.transfers x
   WHERE x.offer_hash = sha256(convert_to(p_offer_token, 'UTF8'))
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown transfer offer' USING ERRCODE = 'no_data_found';
  END IF;
  SELECT * INTO v_ticket FROM ticketing.tickets t WHERE t.id = v_offer.ticket_id FOR UPDATE;
  SELECT e.starts_at INTO v_starts FROM events.events e WHERE e.id = v_ticket.event_id;
  IF v_offer.claimed_at IS NOT NULL OR v_offer.cancelled_at IS NOT NULL
     OR v_offer.expires_at <= now() OR v_starts <= now()
     OR v_ticket.status <> 'bound' OR v_ticket.key_version <> v_offer.from_key_version THEN
    RAISE EXCEPTION 'this transfer offer is no longer open' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF v_ticket.holder_pubkey = p_holder_pubkey THEN
    RAISE EXCEPTION 'the ticket is already on this device' USING ERRCODE = 'check_violation';
  END IF;

  v_version := ticketing.bind(v_offer.ticket_id, p_holder_pubkey, 'transfer');
  UPDATE ticketing.transfers
     SET claimed_at = now(), holder_hash = sha256(convert_to(p_holder_token, 'UTF8')),
         holder_email = p_holder_email
   WHERE id = v_offer.id;
  RETURN v_version;
END
$$;

-- Recovery for a receiver, after orders.recoverable_held listed the claim: a new token
-- replaces the old one and may rebind the ticket once within an hour.
CREATE FUNCTION ticketing.recover_held(p_transfer_id uuid, p_holder_token text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF app.actor_role() IS DISTINCT FROM 'system' THEN
    RAISE EXCEPTION 'only the system recovers received tickets' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_holder_token IS NULL OR length(p_holder_token) < 32 THEN
    RAISE EXCEPTION 'the holder token must have at least 32 characters' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  UPDATE ticketing.transfers x
     SET holder_hash = sha256(convert_to(p_holder_token, 'UTF8')),
         rebind_until = now() + interval '1 hour'
   WHERE x.id = p_transfer_id AND x.holder_email IS NOT NULL
     AND ticketing.is_current_claim(x.id)
     AND EXISTS (SELECT 1 FROM ticketing.tickets t WHERE t.id = x.ticket_id AND t.status = 'bound');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'transfer % cannot be recovered', p_transfer_id USING ERRCODE = 'insufficient_privilege';
  END IF;
END
$$;

-- Binds a recovered receiver's ticket to the new device. Calling it again from the same
-- device answers the same version; another device is refused once the rebinding is spent.
CREATE FUNCTION ticketing.rebind_held(p_holder_token text, p_holder_pubkey bytea)
RETURNS smallint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_offer  ticketing.transfers;
  v_ticket ticketing.tickets;
  v_version smallint;
BEGIN
  IF app.actor_role() IS DISTINCT FROM 'system' THEN
    RAISE EXCEPTION 'only the system rebinds received tickets' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO v_offer FROM ticketing.transfers x
   WHERE x.holder_hash = sha256(convert_to(p_holder_token, 'UTF8'))
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown holder token' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO v_ticket FROM ticketing.tickets t WHERE t.id = v_offer.ticket_id FOR UPDATE;
  IF v_ticket.holder_pubkey = p_holder_pubkey THEN
    RETURN v_ticket.key_version;
  END IF;
  IF v_offer.rebind_until IS NULL OR v_offer.rebind_until <= now()
     OR NOT ticketing.is_current_claim(v_offer.id) THEN
    RAISE EXCEPTION 'this ticket cannot move to another device now'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  v_version := ticketing.bind(v_offer.ticket_id, p_holder_pubkey, 'recovery');
  UPDATE ticketing.transfers SET rebind_until = NULL WHERE id = v_offer.id;
  RETURN v_version;
END
$$;

-- Erasure (14.7): the receiver's email is forgotten on every claim. The tickets stay on
-- their phones; only recovery is lost. Returns how many claims held it.
CREATE FUNCTION ticketing.forget_holder_email(p_email text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_count integer;
BEGIN
  IF app.actor_role() IS DISTINCT FROM 'system' THEN
    RAISE EXCEPTION 'only the system erases receivers' USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE ticketing.transfers SET holder_email = NULL, rebind_until = NULL
   WHERE holder_email = p_email;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END
$$;

GRANT EXECUTE ON FUNCTION ticketing.claim_transfer(text, bytea, text, text) TO passripple_api;
GRANT EXECUTE ON FUNCTION ticketing.recover_held(uuid, text) TO passripple_api;
GRANT EXECUTE ON FUNCTION ticketing.rebind_held(text, bytea) TO passripple_api;
GRANT EXECUTE ON FUNCTION ticketing.forget_holder_email(text) TO passripple_api;
