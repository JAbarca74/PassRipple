BEGIN;
SELECT no_plan();

INSERT INTO identity.users (id, email) VALUES ('00000000-0000-0000-0000-000000000001', 'staff@example.com');
INSERT INTO identity.organizations (id, name) VALUES ('00000000-0000-0000-0000-000000000010', 'Org 1');
INSERT INTO jurisdictions.jurisdictions (canton_code, name, tax_rate_bps, courtesy_deduct_bps, settlement_rule) VALUES ('TEST', 'T', 0, '{}', 'next_business_day');

-- release_user_devices lanza 55006 si el usuario tiene una sesión abierta con el dispositivo dentro de su ventana de subida
INSERT INTO events.events (id, org_id, canton_code, name, venue_name, starts_at, ends_at, age_rating) VALUES ('00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000010', 'TEST', 'Ev', 'V', now(), 'all_ages', now() + interval '1 day');

INSERT INTO staff.staff_codes (id, event_id, role, valid_from, valid_until, max_uses, uses, code_hash) VALUES 
('00000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000020', 'gate', now(), now() + interval '1 day', 10, 1, '\x0100000000000000000000000000000000000000000000000000000000000000'::bytea);

INSERT INTO staff.device_sessions (token_hash, device_id, event_id, user_id, role, valid_from, valid_until) VALUES 
('\x0200000000000000000000000000000000000000000000000000000000000000'::bytea, '00000000-0000-0000-0000-000000000040', '00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000001', 'gate', now(), now() + interval '1 day');

SELECT throws_ok(
    $$SELECT staff.release_user_devices('00000000-0000-0000-0000-000000000001')$$,
    '55006',
    NULL,
    'fails if device inside upload window'
);

-- funciona después de sign_out_device
UPDATE staff.device_sessions SET ended_at = now() WHERE token_hash = '\x0200000000000000000000000000000000000000000000000000000000000000'::bytea;
SELECT lives_ok(
    $$SELECT staff.release_user_devices('00000000-0000-0000-0000-000000000001')$$,
    'succeeds after sign_out_device'
);

-- check it revokes devices
SELECT results_eq(
    $$SELECT revoked_at IS NOT NULL FROM staff.device_sessions WHERE token_hash = '\x0200000000000000000000000000000000000000000000000000000000000000'::bytea$$,
    ARRAY[true],
    'device is revoked'
);

-- funciona si la ventana terminó hace más de 30 días
INSERT INTO staff.device_sessions (token_hash, device_id, event_id, user_id, role, valid_from, valid_until) VALUES 
('\x0300000000000000000000000000000000000000000000000000000000000000'::bytea, '00000000-0000-0000-0000-000000000041', '00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000001', 'gate', now() - interval '40 days', now() - interval '35 days');

SELECT lives_ok(
    $$SELECT staff.release_user_devices('00000000-0000-0000-0000-000000000001')$$,
    'succeeds if window ended > 30 days ago'
);

SELECT * FROM finish();
ROLLBACK;





