BEGIN;

SELECT no_plan();

-- request_sign_in solo como system (otros roles: 42501); ttl 0, negativo o mayor a 30 minutos: 22023.
SET SESSION AUTHORIZATION passripple_api;

SELECT throws_ok(
    $$SELECT identity.request_sign_in('test@example.com', '\x0000000000000000000000000000000000000000000000000000000000000000'::bytea, interval '5 minutes')$$,
    '42501',
    NULL,
    'only system can request_sign_in'
);

RESET SESSION AUTHORIZATION;
SELECT identity.set_actor(NULL, 'system');

SELECT throws_ok(
    $$SELECT identity.request_sign_in('test@example.com', '\x0000000000000000000000000000000000000000000000000000000000000000'::bytea, interval '0')$$,
    '22023',
    NULL,
    'ttl 0 rejected'
);

SELECT throws_ok(
    $$SELECT identity.request_sign_in('test@example.com', '\x0000000000000000000000000000000000000000000000000000000000000000'::bytea, interval '-1 minutes')$$,
    '22023',
    NULL,
    'ttl negative rejected'
);

SELECT throws_ok(
    $$SELECT identity.request_sign_in('test@example.com', '\x0000000000000000000000000000000000000000000000000000000000000000'::bytea, interval '31 minutes')$$,
    '22023',
    NULL,
    'ttl > 30 min rejected'
);

-- Pedir un código nuevo consume los anteriores sin usar
SELECT identity.request_sign_in('consume@example.com', '\x0100000000000000000000000000000000000000000000000000000000000000'::bytea, interval '5 minutes');
SELECT identity.request_sign_in('consume@example.com', '\x0200000000000000000000000000000000000000000000000000000000000000'::bytea, interval '5 minutes');

SELECT results_eq(
    $$SELECT consumed_at IS NOT NULL FROM identity.sign_in_codes WHERE email = 'consume@example.com' AND code_hash = '\x0100000000000000000000000000000000000000000000000000000000000000'::bytea$$,
    ARRAY[true],
    'older code is consumed'
);

SELECT results_eq(
    $$SELECT consumed_at IS NULL FROM identity.sign_in_codes WHERE email = 'consume@example.com' AND code_hash = '\x0200000000000000000000000000000000000000000000000000000000000000'::bytea$$,
    ARRAY[true],
    'new code is not consumed'
);

-- El sexto código para el mismo correo en 15 minutos lanza PR429; correos distintos no se afectan.
SELECT identity.request_sign_in('limit@example.com', '\x0100000000000000000000000000000000000000000000000000000000000000'::bytea, interval '5 minutes');
SELECT identity.request_sign_in('limit@example.com', '\x0200000000000000000000000000000000000000000000000000000000000000'::bytea, interval '5 minutes');
SELECT identity.request_sign_in('limit@example.com', '\x0300000000000000000000000000000000000000000000000000000000000000'::bytea, interval '5 minutes');
SELECT identity.request_sign_in('limit@example.com', '\x0400000000000000000000000000000000000000000000000000000000000000'::bytea, interval '5 minutes');
SELECT identity.request_sign_in('limit@example.com', '\x0500000000000000000000000000000000000000000000000000000000000000'::bytea, interval '5 minutes');

SELECT throws_ok(
    $$SELECT identity.request_sign_in('limit@example.com', '\x0600000000000000000000000000000000000000000000000000000000000000'::bytea, interval '5 minutes')$$,
    'PR429',
    NULL,
    '6th code fails'
);

SELECT lives_ok(
    $$SELECT identity.request_sign_in('other@example.com', '\x0100000000000000000000000000000000000000000000000000000000000000'::bytea, interval '5 minutes')$$,
    'different email not affected by limit'
);

-- verify_sign_in con código equivocado devuelve NULL y el intento queda guardado
SELECT identity.request_sign_in('verify@example.com', '\x0100000000000000000000000000000000000000000000000000000000000000'::bytea, interval '5 minutes');
SELECT is(
    identity.verify_sign_in('verify@example.com', '\x9900000000000000000000000000000000000000000000000000000000000000'::bytea, '\x1100000000000000000000000000000000000000000000000000000000000000'::bytea, interval '1 hour'),
    NULL,
    'wrong code returns NULL'
);
SELECT is(
    identity.verify_sign_in('verify@example.com', '\x9900000000000000000000000000000000000000000000000000000000000000'::bytea, '\x1100000000000000000000000000000000000000000000000000000000000000'::bytea, interval '1 hour'),
    NULL,
    'wrong code returns NULL again'
);

SELECT results_eq(
    $$SELECT attempts FROM identity.sign_in_codes WHERE email = 'verify@example.com' ORDER BY created_at DESC LIMIT 1$$,
    ARRAY[2::smallint],
    '2 failed attempts stored'
);

-- al quinto el código queda consumido
SELECT identity.verify_sign_in('verify@example.com', '\x9900000000000000000000000000000000000000000000000000000000000000'::bytea, '\x1100000000000000000000000000000000000000000000000000000000000000'::bytea, interval '1 hour');
SELECT identity.verify_sign_in('verify@example.com', '\x9900000000000000000000000000000000000000000000000000000000000000'::bytea, '\x1100000000000000000000000000000000000000000000000000000000000000'::bytea, interval '1 hour');
SELECT identity.verify_sign_in('verify@example.com', '\x9900000000000000000000000000000000000000000000000000000000000000'::bytea, '\x1100000000000000000000000000000000000000000000000000000000000000'::bytea, interval '1 hour');
-- next correct fails because attempts = 5 consumed it
SELECT is(
    identity.verify_sign_in('verify@example.com', '\x0100000000000000000000000000000000000000000000000000000000000000'::bytea, '\x1100000000000000000000000000000000000000000000000000000000000000'::bytea, interval '1 hour'),
    NULL,
    'correct code after 5 failures returns NULL'
);

-- vencido ⇒ NULL
-- mock expiry by updating directly
SELECT identity.request_sign_in('verify2@example.com', '\x0100000000000000000000000000000000000000000000000000000000000000'::bytea, interval '5 minutes');
-- BUG: updating expires_at to past violates CHECK (expires_at > created_at)
UPDATE identity.sign_in_codes SET expires_at = now() - interval '1 minute' WHERE email = 'verify2@example.com';
SELECT is(
    identity.verify_sign_in('verify2@example.com', '\x0100000000000000000000000000000000000000000000000000000000000000'::bytea, '\x1100000000000000000000000000000000000000000000000000000000000000'::bytea, interval '1 hour'),
    NULL,
    'expired code returns NULL'
);

-- Con el código correcto crea el usuario (correo en minúsculas)
SELECT identity.request_sign_in('NEW@example.com', '\x0100000000000000000000000000000000000000000000000000000000000000'::bytea, interval '5 minutes');
SELECT isnt(
    identity.verify_sign_in('new@example.com', '\x0100000000000000000000000000000000000000000000000000000000000000'::bytea, '\x1200000000000000000000000000000000000000000000000000000000000000'::bytea, interval '1 hour'),
    NULL,
    'correct code returns a valid user_id'
);
SELECT results_eq(
    $$SELECT email FROM identity.users WHERE email = 'new@example.com'$$,
    ARRAY['new@example.com'::text],
    'email is stored in lowercase'
);

-- un segundo uso ⇒ NULL
SELECT is(
    identity.verify_sign_in('new@example.com', '\x0100000000000000000000000000000000000000000000000000000000000000'::bytea, '\x1300000000000000000000000000000000000000000000000000000000000000'::bytea, interval '1 hour'),
    NULL,
    'second use returns NULL'
);

-- Usuario deshabilitado ⇒ NULL
UPDATE identity.users SET disabled_at = now() WHERE email = 'new@example.com';
SELECT identity.request_sign_in('new@example.com', '\x0200000000000000000000000000000000000000000000000000000000000000'::bytea, interval '5 minutes');
SELECT is(
    identity.verify_sign_in('new@example.com', '\x0200000000000000000000000000000000000000000000000000000000000000'::bytea, '\x1400000000000000000000000000000000000000000000000000000000000000'::bytea, interval '1 hour'),
    NULL,
    'signing in as disabled user returns NULL'
);

-- authenticate_session devuelve el usuario con sesión viva
SELECT identity.request_sign_in('auth@example.com', '\x0100000000000000000000000000000000000000000000000000000000000000'::bytea, interval '5 minutes');
SELECT identity.verify_sign_in('auth@example.com', '\x0100000000000000000000000000000000000000000000000000000000000000'::bytea, '\x1500000000000000000000000000000000000000000000000000000000000000'::bytea, interval '1 hour');

SELECT isnt(
    identity.authenticate_session('\x1500000000000000000000000000000000000000000000000000000000000000'::bytea),
    NULL,
    'authenticate returns user_id'
);

-- NULL tras end_session
SELECT identity.end_session('\x1500000000000000000000000000000000000000000000000000000000000000'::bytea);
SELECT is(
    identity.authenticate_session('\x1500000000000000000000000000000000000000000000000000000000000000'::bytea),
    NULL,
    'end_session makes it NULL'
);

-- passripple_api no tiene SELECT
RESET SESSION AUTHORIZATION;
SET SESSION AUTHORIZATION passripple_api;
SELECT throws_ok(
    $$SELECT * FROM identity.sign_in_codes$$,
    '42501',
    NULL,
    'api cannot select sign_in_codes'
);
SELECT throws_ok(
    $$SELECT * FROM identity.user_sessions$$,
    '42501',
    NULL,
    'api cannot select user_sessions'
);
RESET SESSION AUTHORIZATION;
SELECT identity.set_actor(NULL, 'system');

-- La restricción de users.email rechaza mayúsculas, espacios alrededor y falta de @; dos usuarios no comparten correo
SELECT throws_ok(
    $$INSERT INTO identity.users (email) VALUES ('CAPS@example.com')$$,
    '23514',
    NULL,
    'caps email rejected'
);
SELECT throws_ok(
    $$INSERT INTO identity.users (email) VALUES (' space@example.com')$$,
    '23514',
    NULL,
    'space email rejected'
);
SELECT throws_ok(
    $$INSERT INTO identity.users (email) VALUES ('noatsign')$$,
    '23514',
    NULL,
    'no @ sign email rejected'
);
SELECT throws_ok(
    $$INSERT INTO identity.users (email) VALUES ('auth@example.com')$$,
    '23505',
    NULL,
    'duplicate email rejected'
);

-- Concurrencia (dblink)
CREATE FUNCTION pg_temp.cleanup_i2() RETURNS text LANGUAGE sql AS $f$
  SELECT dblink_exec('setup', $c$
    SET session_replication_role = replica;
    DELETE FROM identity.sign_in_codes WHERE email = 'race@example.com';
    RESET session_replication_role;
  $c$);
$f$;

SELECT dblink_connect(name, format('dbname=%s user=%s', current_database(), (SELECT rolname FROM pg_roles WHERE oid = 10)))
  FROM unnest(ARRAY['setup', 'a', 'b']) AS name;
SELECT pg_temp.cleanup_i2();

SELECT dblink_exec('setup', $$
  INSERT INTO identity.sign_in_codes (email, code_hash, created_at, expires_at) VALUES 
  ('race@example.com', '\x0100000000000000000000000000000000000000000000000000000000000000', now(), now() + interval '5 minutes'),
  ('race@example.com', '\x0200000000000000000000000000000000000000000000000000000000000000', now(), now() + interval '5 minutes'),
  ('race@example.com', '\x0300000000000000000000000000000000000000000000000000000000000000', now(), now() + interval '5 minutes'),
  ('race@example.com', '\x0400000000000000000000000000000000000000000000000000000000000000', now(), now() + interval '5 minutes');
$$);

SELECT dblink_exec(name, 'BEGIN'), dblink_exec(name, 'SET SESSION AUTHORIZATION passripple_api') FROM unnest(ARRAY['a', 'b']) AS name;

SELECT dblink_send_query('a', $$SELECT identity.request_sign_in('race@example.com', '\x0500000000000000000000000000000000000000000000000000000000000000', interval '5 minutes')$$);
SELECT pg_sleep(0.3);
SELECT dblink_send_query('b', $$SELECT identity.request_sign_in('race@example.com', '\x0600000000000000000000000000000000000000000000000000000000000000', interval '5 minutes')$$);
SELECT pg_sleep(0.3);

-- one must fail with PR429
SELECT count(*) > 0 FROM dblink_get_result('a') AS t(err text);
SELECT * FROM dblink_get_result('a') AS t(err text);

SELECT count(*) > 0 FROM dblink_get_result('b') AS t(err text);
SELECT * FROM dblink_get_result('b') AS t(err text);

SELECT dblink_exec('a', 'COMMIT');
SELECT dblink_exec('b', 'COMMIT');

SELECT is(
  (SELECT count(*)::int FROM identity.sign_in_codes WHERE email = 'race@example.com'),
  5,
  'exactly 5 codes allowed'
);

SELECT pg_temp.cleanup_i2();
SELECT dblink_disconnect(name) FROM unnest(ARRAY['setup', 'a', 'b']) AS name;

SELECT * FROM finish();
ROLLBACK;





