# @passripple/staff

**Kind:** module · **Level:** 2 (composite domain)

## Responsibility

Staff codes, device enrollment, roles, zones, time windows and revocation.

## Owns

The `staff` database schema. No other module writes to it (rule R1).

- `staff.staff_devices`: a device allowed at an event, with its user, role (`gate`, `door_sales`, `supervisor`, `inspector`), zone and validity window.

For now an organizer registers devices with `staff.register_device` and revokes them with `staff.revoke_device`; enrollment with a staff code arrives in Phase 2. Organizers see their events' devices, and staff see their own.

## Depends on

- `@passripple/contracts`
- `@passripple/identity`
- `@passripple/events`

## Does not

Validate tickets. It only says who may do it.

## Public API

Everything other packages may use is exported from `src/index.ts`. Deep imports are not allowed.
