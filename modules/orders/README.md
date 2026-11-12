# @passripple/orders

**Kind:** module · **Level:** 3 (transactional)

## Responsibility

Orders without buyer accounts: contact, wallet access token, payment code, exact amount and frozen fees.

## Owns

The `orders` database schema. No other module writes to it (rule R1).

- `orders.orders`: one order per hold, with the buyer's contact (email or phone), the SHA-256 of the wallet's access token, the payment code and the total. Only its status changes, along fixed transitions (`pending` → `paid`, `expired` or `refund_due`; `expired` → `refund_due`; `paid` → `refund_due`; `refund_due` → `refunded`), and it is never deleted.
- `orders.order_items`: append-only order lines with the unit price, fee, fee tax and fee rule frozen at the moment of the sale (invariant I5). No role, the owner included, can update, delete or truncate them.

The API never writes these tables. It calls:

| Function | Who | What |
|---|---|---|
| `orders.create(hold, idem_key, email, phone, access_token, pay_code, unit_fee, unit_fee_tax, fee_rule)` | buyer, system | Creates the order for an active hold. The price comes from the catalog; the fee is calculated by the API with `pricing`. The same idempotency key for the same hold returns the same order |
| `orders.expire_orders(now)` | system | Expires pending orders whose time is up and releases their holds |
| `orders.order_for_token(access_token)` | anyone holding the token | The buyer's wallet: returns only the order the token belongs to |
| `orders.place(hold, idem_key, email, phone, access_token, pay_codes, unit_fee, unit_fee_tax, fee_rule, max_offset)` | buyer, system | The checkout's order: the first free unique amount up to the offset (ADR 0031) and the first free payment code; a repeated key returns the same order (ADR 0033) |
| `orders.order_by_idem_key(idem_key)` | buyer, system | The order a checkout key created, for retries |
| `orders.wallet_access(token)`, `orders.wallet_tickets(token)` | anyone holding the token | The order behind a purchase or recovery token, and its tickets read from `ticketing` in the same statement (ADR 0030) |
| `orders.consume_rebind(token)` | system | A recovery token used its one rebinding |
| `orders.request_contact_code`, `contact_code_challenge`, `use_contact_code` | system | Codes to a buyer's email for recovery and erasure (ADR 0036) |
| `orders.recoverable_orders(code)`, `orders.add_recovery_token(code, order, token)` | system | Recovery tokens for the paid orders of an address |
| `orders.erasure_blockers(code)`, `orders.erase_buyer(code)` | system | A buyer's erasure: contacts and tokens become NULL, once (ADR 0037) |

- `orders.pending_amounts`: the amount each pending order holds, unique platform-wide; a trigger frees it when the order leaves `pending` (ADR 0031).
- `orders.order_tokens`: recovery tokens, by SHA-256 (ADR 0036). `orders.contact_codes`: codes sent to a buyer's email, as an HMAC.
- An erased order keeps its amounts and lines without contact or token (`erased_at`, ADR 0037).
- `orders.outbox`: the domain events this module emitted, written in the same transaction as the change and published by the relay in `workers/jobs` (ADR 0029). Only their publishing time is ever set.

`orders.mark_paid(order)` is for `payments`: a pending order with an active hold becomes paid and its hold becomes issued capacity; a payment that arrives too late leaves the order `refund_due`. The bank reference of a payment lives in `payments`, not here.

## Emits

- `order.paid`, when `orders.mark_paid` turns a pending order into a paid one. `orders.paid_order_lines(order)` gives the consumer what to issue.
- `order.expired`, when `orders.expire_orders` expires a pending order.

## Depends on

- `@passripple/contracts`
- `@passripple/pricing`
- `@passripple/events`
- `@passripple/catalog`
- `@passripple/inventory`
- `@passripple/ticketing` (the wallet reads an order's tickets, ADR 0030)

## Guarantees

- Invariant I5 (see [`docs/architecture.md`](../../docs/architecture.md#2-invariants))

## Does not

Talk to banks or payment providers.

## Public API

Everything other packages may use is exported from `src/index.ts`. Deep imports are not allowed.
