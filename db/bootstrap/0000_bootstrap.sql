-- Runs before every migration. Every statement must be idempotent.

-- Nobody creates objects in the public schema: each module owns its own schema.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

-- Record of applied migrations. Migrations are immutable once applied.
CREATE SCHEMA IF NOT EXISTS migrations;
CREATE TABLE IF NOT EXISTS migrations.applied (
  module     text        NOT NULL,
  file       text        NOT NULL,
  checksum   text        NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (module, file)
);

-- Role used by the API. It can never bypass Row Level Security.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'passripple_api') THEN
    CREATE ROLE passripple_api NOLOGIN NOBYPASSRLS;
  END IF;
END
$$;
