-- Module @passwave/audit owns this schema and is its only writer (rule R1).
CREATE SCHEMA IF NOT EXISTS audit;
COMMENT ON SCHEMA audit IS 'Owned by module @passwave/audit';
