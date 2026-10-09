BEGIN;
SELECT no_plan();

INSERT INTO identity.users (id, email) VALUES ('00000000-0000-0000-0000-000000000001', 'ticket@example.com');
INSERT INTO identity.organizations (id, name) VALUES ('00000000-0000-0000-0000-000000000010', 'Org 1');
INSERT INTO jurisdictions.jurisdictions (canton_code, name, tax_rate_bps, courtesy_deduct_bps, settlement_rule) VALUES ('TEST', 'T', 0, '{}', 'next_business_day');
INSERT INTO events.events (id, org_id, canton_code, name, venue_name, starts_at, ends_at, age_rating) VALUES ('00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000010', 'TEST', 'Ev', 'V', now(), 'all_ages', now() + interval '1 day');
INSERT INTO catalog.ticket_types (id, event_id, name, price_crc, audience) VALUES ('00000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000020', 'P', 1000, 'public');
INSERT INTO inventory.event_capacity (event_id, permitted_capacity, committed) VALUES ('00000000-0000-0000-0000-000000000020', 10, 1);

-- change_xid se fija al insertar y al actualizar, aunque quien llama pase otro valor
INSERT INTO ticketing.tickets (id, event_id, type_id, status, change_xid) VALUES 
('00000000-0000-0000-0000-000000000040', '00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000030', 'issued', '1'::xid8);

SELECT isnt(
    (SELECT change_xid FROM ticketing.tickets WHERE id = '00000000-0000-0000-0000-000000000040'),
    '1'::xid8,
    'change_xid is overwritten on insert'
);

-- update
DO $$
DECLARE v_old xid8; v_new xid8;
BEGIN
  SELECT change_xid INTO v_old FROM ticketing.tickets WHERE id = '00000000-0000-0000-0000-000000000040';
  UPDATE ticketing.tickets SET status = 'bound', change_xid = '2'::xid8 WHERE id = '00000000-0000-0000-0000-000000000040';
  SELECT change_xid INTO v_new FROM ticketing.tickets WHERE id = '00000000-0000-0000-0000-000000000040';
  IF v_new = '2'::xid8 THEN RAISE EXCEPTION 'change_xid was not overwritten'; END IF;
  IF v_old = v_new THEN RAISE EXCEPTION 'change_xid did not advance on update'; END IF;
END $$;

SELECT pass('change_xid advances on update and ignores passed value');

-- bind y void lo adelantan (they perform updates)
DO $$
DECLARE v_old xid8; v_new xid8;
BEGIN
  SELECT change_xid INTO v_old FROM ticketing.tickets WHERE id = '00000000-0000-0000-0000-000000000040';
  PERFORM ticketing.void_tickets(ARRAY['00000000-0000-0000-0000-000000000040'::uuid]);
  SELECT change_xid INTO v_new FROM ticketing.tickets WHERE id = '00000000-0000-0000-0000-000000000040';
  IF v_old = v_new THEN RAISE EXCEPTION 'void did not advance change_xid'; END IF;
END $$;
SELECT pass('void_tickets advances change_xid');

SELECT * FROM finish();
ROLLBACK;





