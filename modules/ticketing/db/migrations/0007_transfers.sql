-- Free transfers through a private link (design 6.6). The holder's phone offers one ticket:
-- the Worker checks that the request is signed with the key the ticket is bound to, and
-- this module keeps the offer under the SHA-256 of the link's secret. Whoever opens the
-- link and claims it binds the ticket to their own device key (reason 'transfer'); the
-- sender's certificate goes stale at once. The receiver gets their own access token for
-- that one ticket, also kept as a SHA-256. No money changes hands: resale is out of scope.
--
-- Rules:
--   - one open offer per ticket; a new offer cancels the previous one;
--   - an offer lasts until its expiry, and never past the event's start;
--   - an offer is valid only for the key version it was made from: any rebinding in
--     between (another transfer, a recovery) voids it;
--   - a transferred ticket belongs to its receiver, so the buyer's recovery (ADR 0036)
--     no longer reaches it: the Worker skips what ticketing.transferred_tickets lists.

CREATE TABLE ticketing.transfers (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id        uuid        NOT NULL REFERENCES ticketing.tickets (id),
  offer_hash       bytea       NOT NULL UNIQUE CHECK (length(offer_hash) = 32),
  from_key_version smallint    NOT NULL CHECK (from_key_version BETWEEN 1 AND 5),
  created_at       timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL,
  cancelled_at     timestamptz,
  claimed_at       timestamptz,
  holder_hash      bytea       UNIQUE CHECK (length(holder_hash) = 32),
  CHECK (expires_at > created_at),
  CHECK (cancelled_at IS NULL OR claimed_at IS NULL),
  CHECK ((claimed_at IS NULL) = (holder_hash IS NULL))
);
CREATE UNIQUE INDEX transfers_one_open_idx ON ticketing.transfers (ticket_id)
  WHERE cancelled_at IS NULL AND claimed_at IS NULL;

ALTER TABLE ticketing.transfers ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
CREATE POLICY transfers_module_read ON ticketing.transfers FOR SELECT USING (app.is_module_role());
CREATE POLICY transfers_module_write ON ticketing.transfers TO passripple_owner_ticketing
  USING (true) WITH CHECK (true);

-- Offers a bound ticket. The caller proved possession of p_holder_pubkey; this checks it
-- is the key the ticket is bound to now. Returns the offer's expiry.
CREATE FUNCTION ticketing.offer_transfer(
  p_ticket_id uuid, p_holder_pubkey bytea, p_offer_token text, p_ttl interval
) RETURNS timestamptz
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
    RAISE EXCEPTION 'only the system offers transfers' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_offer_token IS NULL OR length(p_offer_token) < 32 THEN
    RAISE EXCEPTION 'the offer token must have at least 32 characters' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_ttl IS NULL OR p_ttl <= interval '0' OR p_ttl > interval '7 days' THEN
    RAISE EXCEPTION 'an offer lasts more than nothing and at most 7 days' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO v_ticket FROM ticketing.tickets t WHERE t.id = p_ticket_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ticket % does not exist', p_ticket_id USING ERRCODE = 'no_data_found';
  END IF;
  IF v_ticket.status <> 'bound' OR v_ticket.holder_pubkey IS DISTINCT FROM p_holder_pubkey THEN
    RAISE EXCEPTION 'ticket % is not held by this key', p_ticket_id USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_ticket.key_version >= 6 THEN
    RAISE EXCEPTION 'ticket % has reached its limit of rebindings', p_ticket_id USING ERRCODE = 'check_violation';
  END IF;
  SELECT e.starts_at INTO v_starts FROM events.events e WHERE e.id = v_ticket.event_id;
  IF v_starts <= now() THEN
    RAISE EXCEPTION 'the event of ticket % has started', p_ticket_id USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  v_expires := least(now() + p_ttl, v_starts);

  UPDATE ticketing.transfers SET cancelled_at = now()
   WHERE ticket_id = p_ticket_id AND cancelled_at IS NULL AND claimed_at IS NULL;
  INSERT INTO ticketing.transfers (ticket_id, offer_hash, from_key_version, expires_at)
  VALUES (p_ticket_id, sha256(convert_to(p_offer_token, 'UTF8')), v_ticket.key_version, v_expires);
  RETURN v_expires;
END
$$;

-- Withdraws the open offer of a ticket, if any, for its current holder. Returns whether
-- there was one.
CREATE FUNCTION ticketing.cancel_transfer(p_ticket_id uuid, p_holder_pubkey bytea)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF app.actor_role() IS DISTINCT FROM 'system' THEN
    RAISE EXCEPTION 'only the system cancels transfers' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM ticketing.tickets t
                  WHERE t.id = p_ticket_id AND t.status = 'bound'
                    AND t.holder_pubkey = p_holder_pubkey) THEN
    RAISE EXCEPTION 'ticket % is not held by this key', p_ticket_id USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE ticketing.transfers SET cancelled_at = now()
   WHERE ticket_id = p_ticket_id AND cancelled_at IS NULL AND claimed_at IS NULL;
  RETURN FOUND;
END
$$;

-- What the receiver sees before claiming: the event, the ticket type and the offer's
-- state. Empty when the link is unknown.
CREATE FUNCTION ticketing.transfer_offer(p_offer_token text)
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
                OR t.status <> 'bound' THEN 'cancelled'
           WHEN x.expires_at <= now() OR e.starts_at <= now() THEN 'expired'
           ELSE 'open'
         END
    FROM ticketing.transfers x
    JOIN ticketing.tickets t ON t.id = x.ticket_id
    JOIN catalog.ticket_types tt ON tt.id = t.ticket_type_id
    JOIN events.events e ON e.id = t.event_id
   WHERE x.offer_hash = sha256(convert_to(p_offer_token, 'UTF8'));
$$;

-- Claims an open offer for the receiver's device key and gives them their access token.
-- Returns the ticket's new key version.
CREATE FUNCTION ticketing.claim_transfer(
  p_offer_token text, p_holder_pubkey bytea, p_holder_token text
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
     SET claimed_at = now(), holder_hash = sha256(convert_to(p_holder_token, 'UTF8'))
   WHERE id = v_offer.id;
  RETURN v_version;
END
$$;

-- The receiver's wallet: the ticket their token reaches, in the columns of
-- orders.wallet_tickets. The row stays after the receiver passes it on, so the wallet can
-- tell it moved.
CREATE FUNCTION ticketing.held_ticket(p_holder_token text)
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
    FROM ticketing.transfers x
    JOIN ticketing.tickets t ON t.id = x.ticket_id
    JOIN catalog.ticket_types tt ON tt.id = t.ticket_type_id
    JOIN events.events e ON e.id = t.event_id
   WHERE x.holder_hash = sha256(convert_to(p_holder_token, 'UTF8'));
$$;

-- Of these tickets, the ones that were ever transferred. The buyer's recovery skips them.
CREATE FUNCTION ticketing.transferred_tickets(p_ticket_ids uuid[])
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT DISTINCT b.ticket_id FROM ticketing.ticket_bindings b
   WHERE b.ticket_id = ANY (p_ticket_ids) AND b.reason = 'transfer';
$$;

GRANT EXECUTE ON FUNCTION ticketing.offer_transfer(uuid, bytea, text, interval) TO passripple_api;
GRANT EXECUTE ON FUNCTION ticketing.cancel_transfer(uuid, bytea) TO passripple_api;
GRANT EXECUTE ON FUNCTION ticketing.transfer_offer(text) TO passripple_api;
GRANT EXECUTE ON FUNCTION ticketing.claim_transfer(text, bytea, text) TO passripple_api;
GRANT EXECUTE ON FUNCTION ticketing.held_ticket(text) TO passripple_api;
GRANT EXECUTE ON FUNCTION ticketing.transferred_tickets(uuid[]) TO passripple_api;
