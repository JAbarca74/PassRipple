# @passripple/manifest

**Kind:** module · **Level:** 3 (transactional)

## Responsibility

Builds the secret-free package each gate device downloads before an event.

## Owns

The `manifest` database schema. No other module writes to it (rule R1). It holds functions only: the manifest is read from the modules that own each part.

| Function | Who | What |
|---|---|---|
| `manifest.cursor()` | API | The oldest transaction still running: the cursor of the next incremental update. Read before the tickets |
| `manifest.gate_event(device)` | staff, active device | The device's event, its window and the device's zone |
| `manifest.gate_ticket_types(device)` | staff, active device | The event's ticket types by `ref` |
| `manifest.gate_tickets(device, since)` | staff, active device | Every ticket of the event (or of the device's zone), or only those changed, or scanned, at or after `since`. Unsold tickets are left out |

Only an active device of the acting staff member gets a manifest; revoked and expired devices only upload (ADR 0018).

### Incremental updates

`ticketing.tickets` and `redemption.redemptions` stamp each row with the transaction that last changed it (`change_xid`). The cursor is `pg_snapshot_xmin` of the snapshot taken before reading: every change a device has not seen was made by that transaction or a later one, so `change_xid >= cursor` misses nothing under concurrent writers. A ticket may come twice; each row replaces the device's copy whole.

## TypeScript

`buildGateManifest` and `buildGateManifestDelta` (`src/gate-manifest.ts`) turn the rows of these functions and the server's public key ring into a `GateManifest` or `GateManifestDelta`. Pure: the API runs the queries and passes the clock and the keys.

## Depends on

- `@passripple/contracts`
- `@passripple/crypto`
- `@passripple/events`
- `@passripple/catalog`
- `@passripple/ticketing`
- `@passripple/inventory`
- `@passripple/courtesy`
- `@passripple/staff`
- `@passripple/redemption`

## Guarantees

- Invariant I7 (see [`docs/architecture.md`](../../docs/architecture.md#2-invariants))

## Does not

Sync data back from devices. That is `redemption`.

## Public API

Everything other packages may use is exported from `src/index.ts`. Deep imports are not allowed.
