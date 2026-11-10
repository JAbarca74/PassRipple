# @passripple/settlement

**Kind:** module · **Level:** 4 (consumer)

## Responsibility

Append-only ledger per event, payout statements, payout records and organizer confirmation.

## Owns

The `settlement` database schema. No other module writes to it (rule R1).

- `settlement.ledger_entries`: every movement of an event's money (`payment_in`, `door_sale`, `fee`, `fee_tax`, `refund`, `adjustment`, `payout`), signed and non-zero, with `payment_id` uniqueness on `payment_in`. Append-only: no role, the owner included, updates, deletes or truncates it. A mistake is corrected with an adjustment, which must state its reason. Guarded by invariant I9: a per-event advisory lock rejects any `payout`, `refund` or negative `adjustment` that would make the event's custody balance (all entries excluding `door_sale`) negative.
- `settlement.inbox`: processed domain event message ids (`payment.succeeded`), append-only.
- `settlement.payouts`: one payout record per event (`amount_crc`, `sinpe_ref`, `paid_at`, `confirmed_at`, `due_at`, `created_by`). Only `confirmed_at` may change, once, from `NULL`.

Functions:
- `settlement.record_entry(event, kind, amount, reference, reason)`: the system records movements; only an administrator records adjustments.
- `settlement.record_sale(message, payment, order, event, amount, reference)`: system-only idempotent booking of a paid order's `payment_in`, `fee` and `fee_tax` (reading frozen fees through `orders.order_fee_totals`).
- `settlement.payout_due_at(event, claims_window)`: next business day (Monday–Friday at 09:00 `America/Costa_Rica`) after `ends_at` plus the claims window (24 h default).
- `settlement.record_payout(event, amount, sinpe_ref)`: admin-only, after the 24-hour claims window closes; records the negative `payout` ledger entry and the payout row in one transaction.
- `settlement.confirm_payout(event)`: an organizer of the event's organization confirms receipt once.
- `settlement.statement(event)`: event settlement figures, balance, deadline, overdue flag, informational municipal tax and confirmation timestamp for admins and the event's organizers.
- `settlement.platform_totals()`: admin-only platform custody total, own-income total and overdue event count.

## Depends on

- `@passripple/contracts`
- `@passripple/pricing`
- `@passripple/identity`
- `@passripple/jurisdictions`
- `@passripple/events`
- `@passripple/orders`
- `@passripple/payments`

## Guarantees

- Invariant I9 (see [`docs/architecture.md`](../../docs/architecture.md#2-invariants))

## Does not

Move money. It calculates, records and reminds; a person makes the transfer.

## Public API

Everything other packages may use is exported from `src/index.ts`. Deep imports are not allowed.
