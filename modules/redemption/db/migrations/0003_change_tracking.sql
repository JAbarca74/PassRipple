-- The transaction that recorded each scan, so gate manifests can send which tickets were
-- admitted since a device's last update (see ticketing's 0004_change_tracking.sql). Scans
-- are append-only, so the stamp of the inserting transaction never changes.

ALTER TABLE redemption.redemptions ADD COLUMN change_xid xid8 NOT NULL DEFAULT pg_current_xact_id();

CREATE INDEX redemptions_change_idx ON redemption.redemptions (change_xid);
