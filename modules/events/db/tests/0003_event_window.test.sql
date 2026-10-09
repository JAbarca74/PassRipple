BEGIN;

SELECT no_plan();

-- Create a mock organization and user
INSERT INTO identity.users (id, email) VALUES ('00000000-0000-0000-0000-000000000001', 'org@example.com');
INSERT INTO identity.organizations (id, name) VALUES ('00000000-0000-0000-0000-000000000002', 'Org');
INSERT INTO identity.memberships (org_id, user_id) VALUES ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001');

SET SESSION AUTHORIZATION passripple_api;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000001","org":"00000000-0000-0000-0000-000000000002"}', true);

-- Un evento insertado sin ends_at recibe starts_at + 12 h
INSERT INTO events.events (id, org_id, name, starts_at, age_rating) 
VALUES ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000002', 'Ev1', '2024-01-01 10:00:00+00');

SELECT results_eq(
    'SELECT ends_at FROM events.events WHERE id = ''00000000-0000-0000-0000-000000000003''',
    ARRAY['2024-01-01 22:00:00+00'::timestamptz],
    'ends_at defaults to starts_at + 12 hours'
);

-- Con ends_at explícito lo conserva
INSERT INTO events.events (id, org_id, name, starts_at, ends_at, age_rating) VALUES ('00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000002', 'Ev2', '2024-01-02 10:00:00+00', '2024-01-02 15:00:00+00', 'all_ages');

SELECT results_eq(
    'SELECT ends_at FROM events.events WHERE id = ''00000000-0000-0000-0000-000000000004''',
    ARRAY['2024-01-02 15:00:00+00'::timestamptz],
    'explicit ends_at is preserved'
);

-- ends_at <= starts_at viola events_window
SELECT throws_ok(
    $$INSERT INTO events.events (id, org_id, name, starts_at, ends_at, age_rating) VALUES ('00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000002', 'Ev3', '2024-01-03 10:00:00+00', '2024-01-03 09:00:00+00', 'all_ages')$$,
    '23514',
    NULL,
    'ends_at < starts_at violates CHECK constraint'
);

SELECT throws_ok(
    $$INSERT INTO events.events (id, org_id, name, starts_at, ends_at, age_rating) VALUES ('00000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000002', 'Ev3', '2024-01-03 10:00:00+00', '2024-01-03 10:00:00+00', 'all_ages')$$,
    '23514',
    NULL,
    'ends_at = starts_at violates CHECK constraint'
);

-- mover starts_at después de ends_at falla
SELECT throws_ok(
    $$UPDATE events.events SET starts_at = '2024-01-03 00:00:00+00' WHERE id = '00000000-0000-0000-0000-000000000004'$$,
    '23514',
    NULL,
    'updating starts_at > ends_at violates CHECK constraint'
);

-- passripple_api puede actualizar ends_at
UPDATE events.events SET ends_at = '2024-01-02 20:00:00+00' WHERE id = '00000000-0000-0000-0000-000000000004';
SELECT results_eq(
    'SELECT ends_at FROM events.events WHERE id = ''00000000-0000-0000-0000-000000000004''',
    ARRAY['2024-01-02 20:00:00+00'::timestamptz],
    'passripple_api can update ends_at'
);

-- check other roles cannot (system is owner but passripple_api can due to policies)
RESET SESSION AUTHORIZATION;
SET SESSION AUTHORIZATION passripple_api;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000001","org":"00000000-0000-0000-0000-000000000000"}', true); -- not organizer

SELECT throws_ok(
    $$UPDATE events.events SET ends_at = '2024-01-02 21:00:00+00' WHERE id = '00000000-0000-0000-0000-000000000004'$$,
    '42501',
    NULL,
    'non-organizer cannot update ends_at'
);

SELECT throws_ok(
    $$INSERT INTO events.events (id, org_id, name, starts_at, age_rating) VALUES ('00000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000002', 'Ev3', '2024-01-03 10:00:00+00')$$,
    '42501',
    NULL,
    'non-organizer cannot insert events'
);

SELECT * FROM finish();

ROLLBACK;





