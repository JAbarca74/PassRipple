BEGIN;

SELECT no_plan();

-- setup
INSERT INTO identity.users (id, email) VALUES ('00000000-0000-0000-0000-000000000001', 'erasure@example.com');
INSERT INTO identity.organizations (id, name) VALUES ('00000000-0000-0000-0000-000000000002', 'Org');
INSERT INTO identity.memberships (org_id, user_id) VALUES ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001');

-- insert a sign in code and a session via system
SELECT identity.set_actor(NULL, 'system');
SELECT identity.request_sign_in('erasure@example.com', '\x0100000000000000000000000000000000000000000000000000000000000000'::bytea, interval '5 minutes');
SELECT identity.verify_sign_in('erasure@example.com', '\x0100000000000000000000000000000000000000000000000000000000000000'::bytea, '\x1000000000000000000000000000000000000000000000000000000000000000'::bytea, interval '1 hour');

-- check system/buyer fails
SELECT throws_ok(
    $$SELECT identity.erase_user()$$,
    '42501',
    NULL,
    'system cannot erase user'
);

SELECT identity.set_actor(NULL, 'buyer');
SELECT throws_ok(
    $$SELECT identity.erase_user()$$,
    '42501',
    NULL,
    'buyer cannot erase user'
);

-- set actor to the user
SELECT identity.set_actor('00000000-0000-0000-0000-000000000001', 'organizer');

-- execute erasure
SELECT lives_ok(
    $$SELECT identity.erase_user()$$,
    'user can erase themselves'
);

-- check email is null, user disabled
SELECT results_eq(
    $$SELECT email IS NULL AND disabled_at IS NOT NULL FROM identity.users WHERE id = '00000000-0000-0000-0000-000000000001'$$,
    ARRAY[true],
    'email is null and user is disabled'
);

-- check codes are gone (system role to read them)
SELECT identity.set_actor(NULL, 'system');
SELECT is(
    (SELECT count(*)::int FROM identity.sign_in_codes WHERE email = 'erasure@example.com'),
    0,
    'sign in codes are deleted'
);

-- check sessions ended
SELECT results_eq(
    $$SELECT ended_at IS NOT NULL FROM identity.user_sessions WHERE user_id = '00000000-0000-0000-0000-000000000001'$$,
    ARRAY[true],
    'all user sessions are ended'
);

-- check memberships revoked
SELECT results_eq(
    $$SELECT revoked_at IS NOT NULL FROM identity.memberships WHERE user_id = '00000000-0000-0000-0000-000000000001'$$,
    ARRAY[true],
    'all memberships are revoked'
);

-- check set_actor fails for that user because they are disabled
SELECT throws_ok(
    $$SELECT identity.set_actor('00000000-0000-0000-0000-000000000001', 'organizer')$$,
    'P0001',
    NULL,
    'set_actor fails for disabled user'
);

SELECT * FROM finish();

ROLLBACK;





