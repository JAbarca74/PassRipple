# @passripple/staff

**Kind:** module · **Level:** 2 (composite domain)

## Responsibility

Staff codes, device enrollment, roles, zones, time windows and revocation.

## Owns

The `staff` database schema. No other module writes to it (rule R1).

- `staff.staff_devices`: a device allowed at an event, with its user, role (`gate`, `door_sales`, `supervisor`, `inspector`), zone and validity window.

- `staff.staff_codes`: codes an organizer shares with the staff, tied to an event, role, zone and window, with a maximum number of uses. Stored as a keyed HMAC.
- `staff.device_sessions`: one session per enrolled device, by the SHA-256 of its token.

Organizers see their events' devices and codes (never the codes' hashes), and staff see their own devices.

| Function | Who | What |
|---|---|---|
| `staff.create_code(event, code_hash, role, zone, valid_from, valid_until, max_uses)` | organizer | Creates a staff code for one of its events |
| `staff.revoke_code(code)` | organizer, admin | Nobody else enrolls with it |
| `staff.enroll(code_hash, token_hash, platform, app_version, integrity)` | staff | Enrolls the signed-in person's phone. Allowed before the window opens, so the manifest can be downloaded the day before; an unknown, revoked, used-up or expired code gets the same error |
| `staff.authenticate_device(token_hash)` | before the actor | The device behind a token, with its status: `active`, `revoked` or `expired`. Revoked and expired devices authenticate for 30 more days, to drain their queue (I6) |
| `staff.sign_out_device(device)` | its staff member | Ends the session and revokes the device |
| `staff.register_device`, `staff.revoke_device` | organizer | Register or revoke a device directly |

The integrity verdict (Play Integrity or App Attest) is stored with the device as a signal, never a block.

## Depends on

- `@passripple/contracts`
- `@passripple/identity`
- `@passripple/events`

## Does not

Validate tickets. It only says who may do it.

## Public API

Everything other packages may use is exported from `src/index.ts`. Deep imports are not allowed.
