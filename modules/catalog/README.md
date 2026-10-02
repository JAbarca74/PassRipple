# @passripple/catalog

**Kind:** module · **Level:** 1 (base domain)

## Responsibility

Ticket types, prices and zones.

## Owns

The `catalog` database schema. No other module writes to it (rule R1).

- `catalog.ticket_types`: name, zone, price in whole colones, audience (`public`, `staff`, `performer`) and entry mode. Only staff and performer types may be `multi_scan` (invariant I1); public types are always `single_use`. Each type gets a `ref`, its number within the event (1, 2, 3…), assigned on insert and never changed: credentials carry it as their `type_ref` (ADR 0013).

Public types of events on sale are visible to everyone. Organizers manage the types of their organization's events, and may delete a type only before the event goes on sale.

## Depends on

- `@passripple/contracts`
- `@passripple/events`

## Does not

Track availability. That is `inventory`.

## Public API

Everything other packages may use is exported from `src/index.ts`. Deep imports are not allowed.
