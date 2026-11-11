-- Purchase limits per event (design 9.3, point 5): how many tickets one order may take and
-- how many unpaid orders one buyer (same email or phone) may hold at once. The organizer
-- sets them; inventory and orders enforce them inside the reservation.

ALTER TABLE events.events
  ADD COLUMN max_tickets_per_order smallint NOT NULL DEFAULT 10
    CHECK (max_tickets_per_order BETWEEN 1 AND 100),
  ADD COLUMN max_open_orders_per_buyer smallint NOT NULL DEFAULT 3
    CHECK (max_open_orders_per_buyer BETWEEN 1 AND 20);

GRANT INSERT (max_tickets_per_order, max_open_orders_per_buyer),
      UPDATE (max_tickets_per_order, max_open_orders_per_buyer)
   ON events.events TO passripple_api;
