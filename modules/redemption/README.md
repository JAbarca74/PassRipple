# @passripple/redemption

**Kind:** module · **Level:** 3 (transactional)

## Responsibility

Ticket redemption, applying offline batches from gate devices, and duplicate detection.

## Owns

The `redemption` database schema. No other module writes to it (rule R1).

- `redemption.redemptions`: every scan synced from a gate device, append-only. A partial unique index allows at most one `admitted` scan per single-use ticket (invariant I1, ADR 0012); a second scan is kept as `duplicate`, because no offline operation may be rejected (I6). The entry mode is copied from the ticket, whatever the caller passes, and the ticket must belong to the device's event.

- `redemption.incidents`: append-only. What a device reports (`operator`, `manual_entry_locked`) and what reconciliation raises (`multi_device_redemption`, `out_of_manifest`, `after_revocation`), at most once per scan and kind.

`redemption.record_scan(id, ticket, device, device_seq, scanned_at_device, clock_offset_ms, method, id_checked)` records one scan and returns `admitted` or `duplicate`. It is idempotent by the device-generated id. Staff call it for their own devices; the system calls it for synced batches.

### Offline batches (design 8.7)

`redemption.apply_batch(device, items)` applies 1 to 100 operations from one device and returns one result per operation, in order: `applied`, `duplicate` (the same id was applied before) or `rejected`, and for scans the `outcome` (`admitted` or `duplicate`). Each operation runs in its own `EXCEPTION` block, so one bad operation never fails the batch. Its device's own staff member calls it whatever the device's status, so a revoked or expired device still uploads what it recorded (I6).

| `opType` | Payload | Applied with |
|---|---|---|
| `redemption`, `staff_scan` | `ticketId`, `method`, `idChecked`, `inManifest` | `record_scan`, then reconciliation |
| `incident` | `kind`, `ticketId`, `note` | `INSERT … ON CONFLICT (id) DO NOTHING` |

No queued operation is meant to be rejectable: a rejection means a malformed or inconsistent operation (an unknown type, a ticket of another event), which the device quarantines for a person.

**Reconciliation (8.11)** never undoes anything. After a scan it raises an incident when the same single-use ticket was admitted on another device, when the device admitted a ticket missing from its manifest, and when a revoked device recorded the scan after its revocation (by its corrected clock).

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
