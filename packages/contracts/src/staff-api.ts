// Wire format of sign-in, staff codes and gate device enrollment (design 11.2): what the
// API accepts and returns, shared with the gate app. Schemas validate untrusted input at
// the edge; the database still checks everything again.

import { z } from "zod";

/** Staff roles a code or device can carry. */
export const STAFF_ROLES = ["gate", "door_sales", "supervisor", "inspector"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const DEVICE_PLATFORMS = ["android", "ios"] as const;
export type DevicePlatform = (typeof DEVICE_PLATFORMS)[number];

/** Six decimal digits, sent by email. */
export const SIGN_IN_CODE_PATTERN = /^[0-9]{6}$/;

const email = z.string().trim().toLowerCase().pipe(z.email().max(254));
const isoTime = z.iso.datetime({ offset: true });

export const signInRequest = z.object({ email });
export type SignInRequest = z.infer<typeof signInRequest>;

export const signInResponse = z.object({ expiresInSeconds: z.int().positive() });
export type SignInResponse = z.infer<typeof signInResponse>;

export const verifySignInRequest = z.object({
  email,
  code: z.string().trim().regex(SIGN_IN_CODE_PATTERN),
});
export type VerifySignInRequest = z.infer<typeof verifySignInRequest>;

/** A user session: the bearer token is shown once and only its hash is stored. */
export const userSession = z.object({
  token: z.string(),
  userId: z.uuid(),
  expiresAt: isoTime,
});
export type UserSession = z.infer<typeof userSession>;

/** GET /v1/account/me: who the session is, for the organizer and administration panels. */
export const sessionProfile = z.object({
  userId: z.uuid(),
  isAdmin: z.boolean(),
  /** The organizations this person acts for, by name. Each one goes in X-Org-Id. */
  organizations: z.array(z.object({ id: z.uuid(), name: z.string() })),
});
export type SessionProfile = z.infer<typeof sessionProfile>;

export const createStaffCodeRequest = z
  .object({
    eventId: z.uuid(),
    role: z.enum(STAFF_ROLES),
    zone: z.string().trim().min(1).max(64).nullable().default(null),
    validFrom: isoTime,
    validUntil: isoTime,
    maxUses: z.int().min(1).max(1000),
  })
  .refine((code) => Date.parse(code.validUntil) > Date.parse(code.validFrom), {
    message: "validUntil must be after validFrom",
    path: ["validUntil"],
  });
export type CreateStaffCodeRequest = z.infer<typeof createStaffCodeRequest>;

export const staffCode = z.object({
  id: z.uuid(),
  eventId: z.uuid(),
  role: z.enum(STAFF_ROLES),
  zone: z.string().nullable(),
  validFrom: isoTime,
  validUntil: isoTime,
  maxUses: z.int(),
  uses: z.int(),
  createdAt: isoTime,
  revokedAt: isoTime.nullable(),
});
export type StaffCode = z.infer<typeof staffCode>;

/** A new staff code: the only time the code itself is returned. */
export const createdStaffCode = staffCode.extend({
  /** As shown to people, `4K7NP-9XR2M`. */
  code: z.string(),
});
export type CreatedStaffCode = z.infer<typeof createdStaffCode>;

export const enrollRequest = z.object({
  staffCode: z.string().trim().min(1).max(32),
  platform: z.enum(DEVICE_PLATFORMS),
  appVersion: z.string().trim().min(1).max(32),
  /** Play Integrity or App Attest token, when the platform gave one. A signal, never a block. */
  integrityToken: z.string().max(16_384).nullable().default(null),
});
export type EnrollRequest = z.infer<typeof enrollRequest>;

/**
 * What a gate device may do: active devices validate and download the manifest; revoked or
 * expired devices may only upload what they recorded (invariant I6), then wipe the event.
 */
export const DEVICE_STATUSES = ["active", "revoked", "expired"] as const;
export type DeviceStatus = (typeof DEVICE_STATUSES)[number];

export const gateDevice = z.object({
  deviceId: z.uuid(),
  eventId: z.uuid(),
  role: z.enum(STAFF_ROLES),
  zone: z.string().nullable(),
  validFrom: isoTime,
  validUntil: isoTime,
  status: z.enum(DEVICE_STATUSES),
});
export type GateDevice = z.infer<typeof gateDevice>;

export const enrollResponse = z.object({
  /** The device's bearer token, shown once. The app keeps it in the Keychain or Keystore. */
  deviceToken: z.string(),
  device: gateDevice,
});
export type EnrollResponse = z.infer<typeof enrollResponse>;

export const gateSessionResponse = z.object({
  device: gateDevice,
  /** Milliseconds since the epoch, for the device's clock correction. */
  serverTime: z.int().nonnegative(),
});
export type GateSessionResponse = z.infer<typeof gateSessionResponse>;

/** Error body of every failed API response. */
export const apiError = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});
export type ApiErrorBody = z.infer<typeof apiError>;

/**
 * POST /v1/staff/devices/:id/blocks: the organizer gives a door-sales device a block of
 * seats of one ticket type before the doors open (design 8.5, 10.6). The seats leave the
 * online capacity now; the ones not sold go back when the block is closed.
 */
export const assignBlockRequest = z.object({
  ticketTypeId: z.uuid(),
  size: z.int().min(1).max(1000),
});
export type AssignBlockRequest = z.infer<typeof assignBlockRequest>;

export const assignedBlock = z.object({
  blockId: z.uuid(),
  deviceId: z.uuid(),
  ticketTypeId: z.uuid(),
  size: z.int().min(1),
});
export type AssignedBlock = z.infer<typeof assignedBlock>;

/** POST /v1/staff/blocks/:id/close: how many unsold seats went back to the capacity. */
export const closedBlock = z.object({ blockId: z.uuid(), returned: z.int().nonnegative() });
export type ClosedBlock = z.infer<typeof closedBlock>;
