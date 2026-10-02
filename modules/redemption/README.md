# @passripple/redemption

**Kind:** module · **Level:** 3 (transactional)

## Responsibility

Ticket redemption, applying offline batches from gate devices, and duplicate detection.

## Owns

The `redemption` database schema. No other module writes to it (rule R1).

- `redemption.redemptions`: every scan synced from a gate device, append-only. A partial unique index allows at most one `admitted` scan per single-use ticket (invariant I1, ADR 0012); a second scan is kept as `duplicate`, because no offline operation may be rejected (I6). The entry mode is copied from the ticket, whatever the caller passes, and the ticket must belong to the device's event.

`redemption.record_scan(id, ticket, device, device_seq, scanned_at_device, clock_offset_ms, method, id_checked)` records one scan and returns `admitted` or `duplicate`. It is idempotent by the device-generated id. Staff call it for their own devices; the system calls it for synced batches. `redemption.apply_batch` arrives in Phase 2.

## Depends on

- `@passripple/contracts`
- `@passripple/crypto`
- `@passripple/ticketing`
- `@passripple/staff`

## Guarantees

- Invariant I1 (see [`docs/architecture.md`](../../docs/architecture.md#2-invariants))
- Invariant I6 (see [`docs/architecture.md`](../../docs/architecture.md#2-invariants))

## Does not

Verify signatures (that is `crypto`) or queue operations (that is `outbox`).

## Public API

Everything other packages may use is exported from `src/index.ts`. Deep imports are not allowed.
