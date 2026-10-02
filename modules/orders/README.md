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

`orders.mark_paid(order)` is for `payments`: a pending order with an active hold becomes paid and its hold becomes issued capacity; a payment that arrives too late leaves the order `refund_due`. The bank reference of a payment lives in `payments`, not here.

## Depends on

- `@passripple/contracts`
- `@passripple/pricing`
- `@passripple/events`
- `@passripple/catalog`
- `@passripple/inventory`

## Guarantees

- Invariant I5 (see [`docs/architecture.md`](../../docs/architecture.md#2-invariants))

## Does not

Talk to banks or payment providers.

## Public API

Everything other packages may use is exported from `src/index.ts`. Deep imports are not allowed.
