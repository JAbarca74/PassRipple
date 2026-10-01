-- Tax and oversight rules for each canton, stored as data (rule R6): adding a canton or
-- changing its rules is an INSERT or an UPDATE, never a deployment. This module only
-- stores the rules; the tax package calculates with them.

CREATE TABLE jurisdictions.jurisdictions (
  canton_code         text    PRIMARY KEY
                      CHECK (canton_code ~ '^[0-9A-Za-z][0-9A-Za-z_-]*$' AND length(canton_code) <= 32),
  name                text    NOT NULL CHECK (btrim(name) <> ''),
  -- Rates in basis points: 500 = 5%.
  tax_rate_bps        integer NOT NULL CHECK (tax_rate_bps BETWEEN 0 AND 10000),
  -- Deductible complimentary tickets per ticket category, as {"<category>": <bps>, ...}.
  courtesy_deduct_bps jsonb   NOT NULL
                      CHECK (jsonb_typeof(courtesy_deduct_bps) = 'object'
                             AND NOT jsonb_path_exists(courtesy_deduct_bps,
                               '$.* ? (@.type() != "number" || @ < 0 || @ > 10000 || @ != @.floor())')),
  -- Named rule for the settlement deadline, such as next_business_day.
  settlement_rule     text    NOT NULL CHECK (settlement_rule ~ '^[a-z][a-z0-9_]*$'),
  -- Advance guarantee, when the canton requires one.
  guarantee_bps       integer CHECK (guarantee_bps BETWEEN 0 AND 10000),
  -- Whether the canton accepts digital tickets in place of stamped paper.
  accepts_digital     text    NOT NULL DEFAULT 'unknown'
                      CHECK (accepts_digital IN ('yes', 'no', 'unknown')),
  report_format       text    NOT NULL DEFAULT 'generic' CHECK (report_format ~ '^[a-z][a-z0-9_]*$')
);

COMMENT ON TABLE jurisdictions.jurisdictions IS
  'Tax and oversight rules per canton (rule R6). Public reference data; only admins write it.';

-- Canton rules are public reference data: every role allowed to read the table sees
-- every row, including the modules that depend on this one. Only an admin acting
-- through the API adds or changes a canton. Nobody deletes one: events reference it.
ALTER TABLE jurisdictions.jurisdictions ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;

CREATE POLICY jurisdictions_read ON jurisdictions.jurisdictions
  FOR SELECT USING (true);
CREATE POLICY jurisdictions_admin_insert ON jurisdictions.jurisdictions
  FOR INSERT TO passripple_api WITH CHECK (app.actor_role() = 'admin');
CREATE POLICY jurisdictions_admin_update ON jurisdictions.jurisdictions
  FOR UPDATE TO passripple_api
  USING (app.actor_role() = 'admin') WITH CHECK (app.actor_role() = 'admin');

GRANT USAGE ON SCHEMA jurisdictions TO passripple_api;
GRANT SELECT, INSERT ON jurisdictions.jurisdictions TO passripple_api;
-- The canton code is the key other modules reference, so it cannot be changed.
GRANT UPDATE (name, tax_rate_bps, courtesy_deduct_bps, settlement_rule, guarantee_bps,
              accepts_digital, report_format)
  ON jurisdictions.jurisdictions TO passripple_api;
