BEGIN;
SELECT no_plan();

INSERT INTO identity.users (id, email) VALUES ('00000000-0000-0000-0000-000000000001', 'redemption@example.com');
INSERT INTO directory.organizations (id, name, owner_id) VALUES ('00000000-0000-0000-0000-000000000010', 'Org 1', '00000000-0000-0000-0000-000000000001');
INSERT INTO jurisdictions.jurisdictions (canton_code, name, tax_rate_bps, courtesy_deduct_bps, settlement_rule) VALUES ('TEST', 'T', 0, '{}', 'next_business_day');
INSERT INTO events.events (id, org_id, canton_code, name, venue_name, starts_at, ends_at) VALUES ('00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000010', 'TEST', 'Ev', 'V', now(), now() + interval '1 day');
INSERT INTO catalog.ticket_types (id, event_id, name, price_crc, audience) VALUES ('00000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000020', 'P', 1000, 'public');
INSERT INTO inventory.event_capacity (event_id, permitted_capacity, committed) VALUES ('00000000-0000-0000-0000-000000000020', 10, 1);
INSERT INTO ticketing.tickets (id, event_id, type_id, status) VALUES ('00000000-0000-0000-0000-000000000040', '00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000030', 'issued');
INSERT INTO staff.staff_codes (id, event_id, role, valid_from, valid_until, max_uses, uses, code_hash) VALUES ('00000000-0000-0000-0000-000000000050', '00000000-0000-0000-0000-000000000020', 'gate', now(), now() + interval '1 day', 10, 1, '\x0100000000000000000000000000000000000000000000000000000000000000'::bytea);
INSERT INTO staff.device_sessions (token_hash, device_id, event_id, user_id, role, valid_from, valid_until) VALUES ('\x0200000000000000000000000000000000000000000000000000000000000000'::bytea, '00000000-0000-0000-0000-000000000060', '00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000001', 'gate', now(), now() + interval '1 day');

-- un canje nuevo lo trae de su transacción.
DO $$
DECLARE v_old xid8; v_new xid8;
BEGIN
  SELECT change_xid INTO v_old FROM ticketing.tickets WHERE id = '00000000-0000-0000-0000-000000000040';
  
  INSERT INTO redemption.scans (id, device_id, ticket_id, scanned_at, device_seq, method, id_checked, in_manifest, outcome) VALUES 
  ('00000000-0000-0000-0000-000000000070', '00000000-0000-0000-0000-000000000060', '00000000-0000-0000-0000-000000000040', now(), 1, 'qr', false, true, 'admitted');

  SELECT change_xid INTO v_new FROM ticketing.tickets WHERE id = '00000000-0000-0000-0000-000000000040';
  
  IF v_old = v_new THEN RAISE EXCEPTION 'redemption did not advance change_xid'; END IF;
  IF v_new <> pg_current_xact_id() THEN RAISE EXCEPTION 'redemption did not set change_xid to current xact'; END IF;
END $$;
SELECT pass('new redemption updates ticket change_xid to its transaction');

SELECT * FROM finish();
ROLLBACK;
