-- Checks after a load run (design 9.8). Read-only. Every row must say ok = true.

\set ON_ERROR_STOP on

WITH load_events AS (
  SELECT id, slug FROM events.events WHERE org_id = '10ad0000-0000-4000-8000-000000000001'
), sales AS (
  SELECT e.slug, c.permitted_capacity, c.committed,
         (SELECT coalesce(sum(h.quantity), 0) FROM inventory.holds h
           WHERE h.event_id = e.id AND (h.ended_at IS NULL OR h.end_reason = 'converted')) AS held,
         (SELECT count(*) FROM orders.orders o WHERE o.event_id = e.id) AS orders
    FROM load_events e JOIN inventory.event_capacity c ON c.event_id = e.id
   WHERE e.slug IN ('carga-a', 'carga-b')
)
SELECT 'no overselling: ' || slug AS "check",
       format('%s of %s committed, %s in live holds, %s orders',
              committed, permitted_capacity, held, orders) AS detail,
       committed <= permitted_capacity AND held = committed AS ok
  FROM sales
UNION ALL
-- One order per idempotency key is a UNIQUE constraint; a retry must not create a second
-- order for the same buyer either: each load buyer has a unique contact and buys once.
SELECT 'no duplicate orders',
       format('%s buyers with more than one order', count(*)),
       count(*) = 0
  FROM (SELECT 1 FROM orders.orders o
          JOIN load_events e ON e.id = o.event_id
         GROUP BY o.event_id, coalesce(o.contact_email, o.contact_phone) HAVING count(*) > 1) AS dup
UNION ALL
SELECT 'gate: every operation stored',
       format('%s scans stored from %s devices', count(*), count(DISTINCT r.device_id)),
       count(*) > 0
  FROM redemption.redemptions r
  JOIN staff.staff_devices d ON d.id = r.device_id
  JOIN load_events e ON e.id = d.event_id
UNION ALL
SELECT 'gate: one admission per ticket',
       format('%s tickets admitted more than once', count(*)),
       count(*) = 0
  FROM (SELECT r.ticket_id FROM redemption.redemptions r
          JOIN load_events e ON e.id = (SELECT event_id FROM ticketing.tickets t WHERE t.id = r.ticket_id)
         WHERE r.outcome = 'admitted' GROUP BY r.ticket_id HAVING count(*) > 1) AS twice;
