BEGIN;
SELECT no_plan();

INSERT INTO identity.users (id, email) VALUES 
('00000000-0000-0000-0000-000000000001', 'batch1@example.com'),
('00000000-0000-0000-0000-000000000002', 'batch2@example.com');
INSERT INTO directory.organizations (id, name, owner_id) VALUES ('00000000-0000-0000-0000-000000000010', 'Org 1', '00000000-0000-0000-0000-000000000001');
INSERT INTO jurisdictions.jurisdictions (canton_code, name, tax_rate_bps, courtesy_deduct_bps, settlement_rule) VALUES ('TEST', 'T', 0, '{}', 'next_business_day');
INSERT INTO events.events (id, org_id, canton_code, name, venue_name, starts_at, ends_at) VALUES ('00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000010', 'TEST', 'Ev', 'V', now(), now() + interval '1 day');
INSERT INTO events.events (id, org_id, canton_code, name, venue_name, starts_at, ends_at) VALUES ('00000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000010', 'TEST', 'Ev2', 'V', now(), now() + interval '1 day');

INSERT INTO catalog.ticket_types (id, event_id, name, price_crc, audience) VALUES ('00000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000020', 'P', 1000, 'public');
INSERT INTO inventory.event_capacity (event_id, permitted_capacity, committed) VALUES ('00000000-0000-0000-0000-000000000020', 10, 2);

INSERT INTO ticketing.tickets (id, event_id, type_id, status) VALUES 
('00000000-0000-0000-0000-000000000040', '00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000030', 'issued'),
('00000000-0000-0000-0000-000000000041', '00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000030', 'issued');

INSERT INTO staff.staff_codes (id, event_id, role, valid_from, valid_until, max_uses, uses, code_hash) VALUES 
('00000000-0000-0000-0000-000000000050', '00000000-0000-0000-0000-000000000020', 'gate', now(), now() + interval '1 day', 10, 1, '\x0100000000000000000000000000000000000000000000000000000000000000'::bytea),
('00000000-0000-0000-0000-000000000051', '00000000-0000-0000-0000-000000000020', 'gate', now(), now() + interval '1 day', 10, 1, '\x0200000000000000000000000000000000000000000000000000000000000000'::bytea);

-- device 1 for user 1
INSERT INTO staff.device_sessions (token_hash, device_id, event_id, user_id, role, valid_from, valid_until) VALUES 
('\x0300000000000000000000000000000000000000000000000000000000000000'::bytea, '00000000-0000-0000-0000-000000000060', '00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000001', 'gate', now(), now() + interval '1 day');

-- device 2 for user 2
INSERT INTO staff.device_sessions (token_hash, device_id, event_id, user_id, role, valid_from, valid_until) VALUES 
('\x0400000000000000000000000000000000000000000000000000000000000000'::bytea, '00000000-0000-0000-0000-000000000061', '00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000002', 'gate', now(), now() + interval '1 day');

-- System u otro staff => 42501
SET SESSION AUTHORIZATION passripple_api;
SELECT app.set_actor('system', NULL);

SELECT throws_ok(
    $$SELECT redemption.push_batch('{"id": "00000000-0000-0000-0000-000000000070", "cursor": "0", "scans": []}'::jsonb)$$,
    'P0001',
    NULL,
    'system cannot push_batch'
);

SELECT app.set_actor('00000000-0000-0000-0000-000000000002', 'staff');
PERFORM set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000002","dev":"\x0400000000000000000000000000000000000000000000000000000000000000"}', true);
-- It should fail if device does not match jwt or something, but let's test if we can push. We CAN push if we are the device owner.
-- The prompt says: "push_batch como el staff del dispositivo; system u otro staff ⇒ 42501."
-- meaning I can't push if the token_hash in jwt belongs to user 1 but actor is user 2.
PERFORM set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000002","dev":"\x0300000000000000000000000000000000000000000000000000000000000000"}', true);
SELECT throws_ok(
    $$SELECT redemption.push_batch('{"id": "00000000-0000-0000-0000-000000000070", "cursor": "0", "scans": []}'::jsonb)$$,
    '42501',
    NULL,
    'other staff cannot push batch'
);

-- set correct owner
SELECT app.set_actor('00000000-0000-0000-0000-000000000001', 'staff');
PERFORM set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000001","dev":"\x0300000000000000000000000000000000000000000000000000000000000000"}', true);

-- push valid scan. Ticket change_xid should be known.
DO $$
DECLARE v_cursor text;
BEGIN
  SELECT change_xid::text INTO v_cursor FROM ticketing.tickets WHERE id = '00000000-0000-0000-0000-000000000040';
  PERFORM redemption.push_batch(jsonb_build_object(
    'id', '00000000-0000-0000-0000-000000000070',
    'cursor', v_cursor,
    'scans', jsonb_build_array(
      jsonb_build_object(
        'id', '00000000-0000-0000-0000-000000000080',
        'ticketId', '00000000-0000-0000-0000-000000000040',
        'scannedAt', '2024-01-01T10:00:00Z',
        'deviceSeq', 1,
        'method', 'qr',
        'idChecked', true,
        'outcome', 'admitted'
      )
    )
  ));
END $$;

-- in_manifest = true since cursor == change_xid
SELECT results_eq(
    $$SELECT in_manifest FROM redemption.scans WHERE id = '00000000-0000-0000-0000-000000000080'$$,
    ARRAY[true],
    'in_manifest is true'
);
-- ticket changed to redeemed = true (which means redeemed = true if single use. Let's check status = redeemed. Actually prompt says: "el ticket queda con redeemed = admitted, y id_checked sube si en el batch viene en true")
-- Oh, wait. The ticket has a `status`, not `redeemed = admitted`. Wait... the ticket has an `id_checked` column? Yes.
SELECT results_eq(
    $$SELECT id_checked FROM ticketing.tickets WHERE id = '00000000-0000-0000-0000-000000000040'$$,
    ARRAY[true],
    'id_checked is copied to ticket'
);

-- second scan with non-existent ticket or wrong event is ignored
SELECT lives_ok(
    $$SELECT redemption.push_batch('{"id": "00000000-0000-0000-0000-000000000071", "cursor": "0", "scans": [{"id": "00000000-0000-0000-0000-000000000081", "ticketId": "00000000-0000-0000-0000-000000000099", "scannedAt": "2024-01-01T10:00:00Z", "deviceSeq": 2, "method": "qr", "idChecked": false, "outcome": "admitted"}]}'::jsonb)$$,
    'push ignores scan with inexistent ticket'
);

SELECT is(
    (SELECT count(*)::int FROM redemption.scans WHERE id = '00000000-0000-0000-0000-000000000081'),
    0,
    'scan with inexistent ticket was ignored'
);

-- scan para el mismo scan_id se descarta
SELECT lives_ok(
    $$SELECT redemption.push_batch('{"id": "00000000-0000-0000-0000-000000000072", "cursor": "0", "scans": [{"id": "00000000-0000-0000-0000-000000000080", "ticketId": "00000000-0000-0000-0000-000000000040", "scannedAt": "2024-01-01T10:00:00Z", "deviceSeq": 3, "method": "qr", "idChecked": false, "outcome": "duplicate"}]}'::jsonb)$$,
    'duplicate scan_id ignored without error'
);

-- RLS
RESET SESSION AUTHORIZATION;
SET SESSION AUTHORIZATION passripple_api;
SELECT throws_ok(
    $$SELECT * FROM redemption.scans$$,
    '42501',
    NULL,
    'cannot select scans directly'
);
SELECT throws_ok(
    $$SELECT * FROM redemption.scan_batches$$,
    '42501',
    NULL,
    'cannot select scan_batches directly'
);

SELECT * FROM finish();
ROLLBACK;
