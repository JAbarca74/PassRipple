# @passripple/settlement

**Kind:** module · **Level:** 4 (consumer)

## Responsibility

Append-only ledger per event, payout statements, payout records and organizer confirmation.

## Owns

The `settlement` database schema. No other module writes to it (rule R1).

- `settlement.ledger_entries`: every movement of an event's money (`payment_in`, `door_sale`, `fee`, `fee_tax`, `refund`, `adjustment`, `payout`), signed and non-zero. Append-only: no role, the owner included, updates, deletes or truncates it. A mistake is corrected with an adjustment, which must state its reason.

`settlement.record_entry(event, kind, amount, reference, reason)` records an entry: the system records movements, and only an administrator records adjustments. Organizers read their organization's events. Payout statements and invariant I9 arrive in Phase 4.

## Depends on

- `@passripple/contracts`
- `@passripple/pricing`
- `@passripple/identity`
- `@passripple/events`
- `@passripple/orders`
- `@passripple/payments`

## Guarantees

- Invariant I9 (see [`docs/architecture.md`](../../docs/architecture.md#2-invariants))

## Does not

Move money. It calculates, records and reminds; a person makes the transfer.

## Public API

Everything other packages may use is exported from `src/index.ts`. Deep imports are not allowed.
