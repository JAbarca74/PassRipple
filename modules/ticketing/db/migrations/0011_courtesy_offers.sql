-- Complimentary tickets delivered by link (design 6.6, I3): the organizer grants a courtesy
-- and gets one private link per ticket, the same kind a holder creates to transfer one.
-- Whoever opens it claims the ticket on their own phone. The ticket waits unbound (issued,
-- key version 0) until then, so the offer starts from key version 0.

ALTER TABLE ticketing.transfers DROP CONSTRAINT transfers_from_key_version_check;
ALTER TABLE ticketing.transfers
  ADD CONSTRAINT transfers_from_key_version_check CHECK (from_key_version BETWEEN 0 AND 5);

-- Opens the claim link of an unbound courtesy ticket, until p_expires_at or the event's
-- start. The system only. A new link replaces the ticket's open one.
CREATE FUNCTION ticketing.offer_courtesy(p_ticket_id uuid, p_offer_token text, p_ttl interval)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_ticket  ticketing.tickets;
  v_starts  timestamptz;
  v_expires timestamptz;
BEGIN
  IF app.actor_role() IS DISTINCT FROM 'system' THEN
    RAISE EXCEPTION 'only the system offers courtesies' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_offer_token IS NULL OR length(p_offer_token) < 32 THEN
    RAISE EXCEPTION 'the offer token must have at least 32 characters' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_ttl IS NULL OR p_ttl <= interval '0' OR p_ttl > interval '30 days' THEN
    RAISE EXCEPTION 'a courtesy link lasts more than nothing and at most 30 days' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO v_ticket FROM ticketing.tickets t WHERE t.id = p_ticket_id FOR UPDATE;
  IF NOT FOUND OR v_ticket.origin <> 'courtesy' OR v_ticket.status <> 'issued' THEN
    RAISE EXCEPTION 'ticket % is not an unclaimed courtesy', p_ticket_id
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT e.starts_at INTO v_starts FROM events.events e WHERE e.id = v_ticket.event_id;
  v_expires := least(now() + p_ttl, v_starts);
  IF v_expires <= now() THEN
    RAISE EXCEPTION 'the event of ticket % has started', p_ticket_id USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  UPDATE ticketing.transfers SET cancelled_at = now()
   WHERE ticket_id = p_ticket_id AND cancelled_at IS NULL AND claimed_at IS NULL;
  INSERT INTO ticketing.transfers (ticket_id, offer_hash, from_key_version, expires_at)
  VALUES (p_ticket_id, sha256(convert_to(p_offer_token, 'UTF8')), 0, v_expires);
  RETURN v_expires;
END
$$;

GRANT EXECUTE ON FUNCTION ticketing.offer_courtesy(uuid, text, interval) TO passripple_api;

-- claim_transfer, now also for courtesies waiting unbound.
CREATE OR REPLACE FUNCTION ticketing.claim_transfer(
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
     OR v_ticket.key_version <> v_offer.from_key_version
     OR NOT (v_ticket.status = 'bound'
             -- A courtesy waits unbound for its receiver (0011).
             OR (v_ticket.status = 'issued' AND v_ticket.origin = 'courtesy'
                 AND v_offer.from_key_version = 0)) THEN
    RAISE EXCEPTION 'this transfer offer is no longer open' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF v_ticket.holder_pubkey = p_holder_pubkey THEN
    RAISE EXCEPTION 'the ticket is already on this device' USING ERRCODE = 'check_violation';
  END IF;

  v_version := ticketing.bind(v_offer.ticket_id, p_holder_pubkey,
                             CASE WHEN v_ticket.status = 'issued' THEN 'bind' ELSE 'transfer' END);
  UPDATE ticketing.transfers
     SET claimed_at = now(), holder_hash = sha256(convert_to(p_holder_token, 'UTF8')),
         holder_email = p_holder_email
   WHERE id = v_offer.id;
  RETURN v_version;
END
$$;

-- transfer_offer, so the receiver's preview of an unclaimed courtesy says it is open.
CREATE OR REPLACE FUNCTION ticketing.transfer_offer(p_offer_token text)
RETURNS TABLE (event_name text, venue_name text, starts_at timestamptz, type_name text,
               expires_at timestamptz, state text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT e.name, e.venue_name, e.starts_at, tt.name, x.expires_at,
         CASE
           WHEN x.claimed_at IS NOT NULL THEN 'claimed'
           WHEN x.cancelled_at IS NOT NULL OR t.key_version <> x.from_key_version
                OR NOT (t.status = 'bound'
                        OR (t.status = 'issued' AND t.origin = 'courtesy' AND x.from_key_version = 0))
             THEN 'cancelled'
           WHEN x.expires_at <= now() OR e.starts_at <= now() THEN 'expired'
           ELSE 'open'
         END
    FROM ticketing.transfers x
    JOIN ticketing.tickets t ON t.id = x.ticket_id
    JOIN catalog.ticket_types tt ON tt.id = t.ticket_type_id
    JOIN events.events e ON e.id = t.event_id
   WHERE x.offer_hash = sha256(convert_to(p_offer_token, 'UTF8'));
$$;
