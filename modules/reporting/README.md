# @passripple/reporting

**Kind:** module · **Level:** 4 (consumer)

## Responsibility

Aggregated counters for dashboards and gate device sync status. Read-only.

## Owns

The `reporting` database schema. No other module writes to it (rule R1).

- `reporting.event_counters(event)`: permitted and committed capacity, tickets sold, courtesies and door sales (voided and unsold left out), distinct tickets admitted, duplicates refused, incidents, and tickets sold per hour over the last 12 hours in Costa Rica time.
- `reporting.event_devices(event)`: each staff device with its role, zone, enrollment, revocation, last synchronization (the last scan or incident the server received), admissions and incidents.

Both are computed on demand and readable by an organizer of the event's organization or an administrator. Operations still queued on a phone are unknown until uploaded, so a device shows its last synchronization, not a guess.

## Depends on

- `@passripple/contracts`
- `@passripple/events`
- `@passripple/inventory`
- `@passripple/ticketing`
- `@passripple/staff`
- `@passripple/redemption`

## Does not

Write domain data.

## Public API

Everything other packages may use is exported from `src/index.ts`. Deep imports are not allowed.
