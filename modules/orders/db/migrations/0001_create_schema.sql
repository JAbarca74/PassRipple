-- Module @passripple/orders owns this schema and is its only writer (rule R1).
CREATE SCHEMA IF NOT EXISTS orders;
COMMENT ON SCHEMA orders IS 'Owned by module @passripple/orders';
