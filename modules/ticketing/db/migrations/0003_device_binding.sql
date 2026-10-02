-- Device binding (6.2, 6.6, ADR 0016). A ticket is bound to the Ed25519 public key of the
-- buyer's device, and the server certifies that binding. Every binding gets the next key
-- version: 1 for the first, then one more on each transfer or recovery. A certificate
-- names its key version, so a newer binding makes every older certificate stale (the
-- gate device compares it with the manifest, step 4 of 6.3).
--
-- What holds for every role, the owner included:
--   - a ticket starts unbound: no key and key version 0;
--   - the key version only moves up, by exactly one, and only when the key changes;
--   - every key version has its row in ticket_bindings, written before the ticket moves
--     to it, and that history is append-only;
--   - the first binding and at most five rebindings: key version 6 is the last.

-- The fallback code is exactly ten characters (6.7, ADR 0015).
ALTER TABLE ticketing.tickets
  DROP CONSTRAINT tickets_code_human_check,
  ADD CONSTRAINT tickets_code_human_check CHECK (code_human ~ '^[0-9A-HJKMNP-TV-Z]{10}$'),
  ADD CONSTRAINT tickets_key_version_cap CHECK (key_version <= 6);

CREATE TABLE ticketing.ticket_bindings (
  ticket_id     uuid        NOT NULL REFERENCES ticketing.tickets (id),
  key_version   smallint    NOT NULL CHECK (key_version BETWEEN 1 AND 6),
  holder_pubkey bytea       NOT NULL CHECK (length(holder_pubkey) = 32),
  -- bind: the first binding; transfer: to another person; recovery: to a new device of
  -- the same person.
  reason        text        NOT NULL CHECK (reason IN ('bind', 'transfer', 'recovery')),
  bound_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ticket_id, key_version),
  CHECK ((key_version = 1) = (reason = 'bind'))
);

-- A binding row is always the ticket's next key version, to a key it does not hold yet.
CREATE FUNCTION ticketing.check_binding()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
  v_version smallint;
  v_pubkey  bytea;
BEGIN
  SELECT t.key_version, t.holder_pubkey INTO v_version, v_pubkey
    FROM ticketing.tickets t WHERE t.id = NEW.ticket_id;
  IF NEW.key_version IS DISTINCT FROM v_version + 1 THEN
    RAISE EXCEPTION 'ticket %: the next key version is %, not %', NEW.ticket_id, v_version + 1, NEW.key_version
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.holder_pubkey = v_pubkey THEN
    RAISE EXCEPTION 'ticket % is already bound to this key', NEW.ticket_id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;

-- At commit, the ticket has reached every key version recorded for it: no binding row is
-- left behind without the ticket moving to it.
CREATE FUNCTION ticketing.check_binding_applied()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM ticketing.tickets t
                  WHERE t.id = NEW.ticket_id AND t.key_version >= NEW.key_version) THEN
    RAISE EXCEPTION 'ticket % never moved to key version %', NEW.ticket_id, NEW.key_version
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NULL;
END
$$;

CREATE TRIGGER ticket_bindings_check BEFORE INSERT ON ticketing.ticket_bindings
  FOR EACH ROW EXECUTE FUNCTION ticketing.check_binding();
CREATE CONSTRAINT TRIGGER ticket_bindings_applied AFTER INSERT ON ticketing.ticket_bindings
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ticketing.check_binding_applied();
CREATE TRIGGER ticket_bindings_append_only BEFORE UPDATE OR DELETE ON ticketing.ticket_bindings
  FOR EACH ROW EXECUTE FUNCTION app.reject_mutation();
CREATE TRIGGER ticket_bindings_no_truncate BEFORE TRUNCATE ON ticketing.ticket_bindings
  FOR EACH STATEMENT EXECUTE FUNCTION app.reject_mutation();

-- A ticket is issued unbound, whatever the caller passes.
CREATE FUNCTION ticketing.start_unbound()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF NEW.holder_pubkey IS NOT NULL OR NEW.key_version <> 0 OR NEW.status = 'bound' THEN
    RAISE EXCEPTION 'a ticket is issued unbound; bind it with ticketing.bind'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER tickets_start_unbound BEFORE INSERT ON ticketing.tickets
  FOR EACH ROW EXECUTE FUNCTION ticketing.start_unbound();

-- Replaces the guard of 0002_tickets.sql with the same rules plus those of binding.
--   unsold → issued | void      issued → bound | void      bound → bound | void
-- The key changes only on a bound ticket, to a non-null key, with the key version up by
-- exactly one and its binding row already written. Otherwise the key version stays.
CREATE OR REPLACE FUNCTION ticketing.guard_ticket_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF (NEW.id, NEW.event_id, NEW.ticket_type_id, NEW.order_id, NEW.origin, NEW.block_id,
      NEW.code_human, NEW.entry_mode, NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.event_id, OLD.ticket_type_id, OLD.order_id, OLD.origin, OLD.block_id,
      OLD.code_human, OLD.entry_mode, OLD.created_at) THEN
    RAISE EXCEPTION 'ticket %: only its status and binding can change', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF (OLD.status, NEW.status) NOT IN (('unsold', 'unsold'), ('unsold', 'issued'), ('unsold', 'void'),
                                      ('issued', 'issued'), ('issued', 'bound'), ('issued', 'void'),
                                      ('bound', 'bound'), ('bound', 'void'), ('void', 'void')) THEN
    RAISE EXCEPTION 'ticket %: % cannot become %', OLD.id, OLD.status, NEW.status
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status = 'void' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'ticket % is void', OLD.id USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.holder_pubkey IS DISTINCT FROM OLD.holder_pubkey THEN
    IF NEW.holder_pubkey IS NULL OR NEW.status <> 'bound' THEN
      RAISE EXCEPTION 'ticket %: a key is only ever replaced by another, on a bound ticket', OLD.id
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.key_version IS DISTINCT FROM OLD.key_version + 1 THEN
      RAISE EXCEPTION 'ticket %: a new key takes key version %', OLD.id, OLD.key_version + 1
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM ticketing.ticket_bindings b
                    WHERE b.ticket_id = OLD.id AND b.key_version = NEW.key_version
                      AND b.holder_pubkey = NEW.holder_pubkey) THEN
      RAISE EXCEPTION 'ticket %: key version % has no binding record', OLD.id, NEW.key_version
        USING ERRCODE = 'restrict_violation';
    END IF;
  ELSIF NEW.key_version IS DISTINCT FROM OLD.key_version THEN
    RAISE EXCEPTION 'ticket %: the key version changes only with the key', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;

-- ── Row Level Security ───────────────────────────────────────────────────────
ALTER TABLE ticketing.ticket_bindings ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;

CREATE POLICY ticket_bindings_module_read ON ticketing.ticket_bindings FOR SELECT
  USING (app.is_module_role());
CREATE POLICY ticket_bindings_module_write ON ticketing.ticket_bindings TO passripple_owner_ticketing
  USING (true) WITH CHECK (true);
-- Through the tickets, whose own policy limits organizers to their events.
CREATE POLICY ticket_bindings_api_read ON ticketing.ticket_bindings FOR SELECT TO passripple_api
  USING (EXISTS (SELECT 1 FROM ticketing.tickets t WHERE t.id = ticket_bindings.ticket_id));

GRANT SELECT ON ticketing.ticket_bindings TO passripple_api;

-- ── Functions ────────────────────────────────────────────────────────────────
-- Binds a ticket to a device key and returns its new key version. Called by the system:
-- after a payment, when the waiting wallet registers its key (reason 'bind'); when a
-- ticket is transferred ('transfer'); or when the buyer recovers it on a new device
-- ('recovery'). The issuing Worker then signs a certificate for the new key version, and
-- the API emits ticket.bound or ticket.transferred. Whether the key is an acceptable
-- Ed25519 point is checked by crypto, which refuses to certify any other.
CREATE FUNCTION ticketing.bind(p_ticket_id uuid, p_holder_pubkey bytea, p_reason text)
RETURNS smallint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_status  text;
  v_version smallint;
BEGIN
  IF app.actor_role() IS DISTINCT FROM 'system' THEN
    RAISE EXCEPTION 'only the system binds tickets' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT t.status, t.key_version INTO v_status, v_version
    FROM ticketing.tickets t WHERE t.id = p_ticket_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ticket % does not exist', p_ticket_id USING ERRCODE = 'no_data_found';
  END IF;
  IF p_reason = 'bind' THEN
    IF v_status <> 'issued' THEN
      RAISE EXCEPTION 'ticket % is %, so it cannot be bound', p_ticket_id, v_status
        USING ERRCODE = 'restrict_violation';
    END IF;
  ELSIF p_reason IN ('transfer', 'recovery') THEN
    IF v_status <> 'bound' THEN
      RAISE EXCEPTION 'ticket % is %, so it cannot be rebound', p_ticket_id, v_status
        USING ERRCODE = 'restrict_violation';
    END IF;
  ELSE
    RAISE EXCEPTION 'unknown binding reason %', p_reason USING ERRCODE = 'check_violation';
  END IF;
  IF v_version >= 6 THEN
    RAISE EXCEPTION 'ticket % has reached its limit of rebindings', p_ticket_id
      USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO ticketing.ticket_bindings (ticket_id, key_version, holder_pubkey, reason)
  VALUES (p_ticket_id, v_version + 1, p_holder_pubkey, p_reason);
  UPDATE ticketing.tickets
     SET holder_pubkey = p_holder_pubkey, key_version = v_version + 1, status = 'bound'
   WHERE id = p_ticket_id;
  RETURN v_version + 1;
END
$$;

GRANT EXECUTE ON FUNCTION ticketing.bind(uuid, bytea, text) TO passripple_api;
