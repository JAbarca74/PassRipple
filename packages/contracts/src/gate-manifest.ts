// The package a gate device downloads before an event (8.3). It holds no secret: only
// identifiers, states, public keys and fallback codes, so whoever extracts it from a phone
// cannot forge a credential (invariant I7).
//
// It travels as JSON, with bytes as base64url, and arrives whole the first time and as
// deltas after that: the device passes back the manifest's cursor and gets the tickets that
// changed since (new tickets, voids, rebindings and admissions). Each ticket in a delta
// replaces the device's copy whole, and the same ticket may come more than once.
// Attendee data (Phase 7), door-sale blocks and courtesy quotas join it in later phases.

import { z } from "zod";
import { decodeBase64url, encodeBase64url } from "./base64url.ts";
import type { AgeRating, EntryMode } from "./credential-format.ts";

export const GATE_MANIFEST_VERSION = 1;

/** One of the server's public keys valid for the event's credentials. */
export interface ManifestServerKey {
  /** 0 to 255, as written in each certificate. */
  readonly id: number;
  /** 32-byte Ed25519 public key. */
  readonly publicKey: Uint8Array;
}

export type TicketAudience = "public" | "staff" | "performer";

/** A ticket type of the event, by the number credentials carry (`type_ref`). */
export interface ManifestTicketType {
  readonly ref: number;
  readonly name: string;
  readonly zone: string | null;
  readonly entryMode: EntryMode;
  readonly audience: TicketAudience;
}

/** What a gate device knows about one ticket (step 4 of 6.3). */
export interface ManifestTicket {
  /** Lowercase UUID. */
  readonly ticketId: string;
  /** The ticket type's number within the event. */
  readonly typeRef: number;
  readonly entryMode: EntryMode;
  readonly status: "issued" | "bound" | "void";
  /** Whether a single-use ticket was already admitted, as last synced. */
  readonly redeemed: boolean;
  /** 32-byte Ed25519 public key of the buyer's device, once bound. */
  readonly holderPubkey: Uint8Array | null;
  /** Credentials of any lower key version are stale. 0 while unbound. */
  readonly keyVersion: number;
  /** The fallback code, canonical form, for manual entry. */
  readonly codeHuman: string;
}

export interface ManifestEvent {
  readonly name: string;
  readonly venueName: string;
  /** ISO 8601. */
  readonly startsAt: string;
  /** ISO 8601. The end of the event's window. */
  readonly endsAt: string;
  readonly ageRating: AgeRating;
}

export interface GateManifest {
  readonly formatVersion: typeof GATE_MANIFEST_VERSION;
  /** Lowercase UUID of the event. */
  readonly eventId: string;
  readonly event: ManifestEvent;
  /** The zone the device admits to, or null for every zone. */
  readonly deviceZone: string | null;
  /** ISO 8601. After this the device deletes the event's data once its queue is empty (8.3). */
  readonly expiresAt: string;
  /** The server keys a device trusts for this event: its key ring. */
  readonly serverKeys: readonly ManifestServerKey[];
  readonly ticketTypes: readonly ManifestTicketType[];
  readonly tickets: readonly ManifestTicket[];
  /** Pass it back as `since` to get only what changed after this manifest. */
  readonly cursor: string;
  /** Milliseconds since the epoch when the server built it, for clock correction. */
  readonly serverTime: number;
}

/**
 * What changed since a cursor. The key ring and the ticket types come whole, replacing the
 * device's; the tickets are the ones that changed.
 */
export interface GateManifestDelta {
  readonly formatVersion: typeof GATE_MANIFEST_VERSION;
  readonly eventId: string;
  readonly since: string;
  readonly expiresAt: string;
  readonly serverKeys: readonly ManifestServerKey[];
  readonly ticketTypes: readonly ManifestTicketType[];
  readonly tickets: readonly ManifestTicket[];
  readonly cursor: string;
  readonly serverTime: number;
}

// ── Wire format ──────────────────────────────────────────────────────────────

const PUBLIC_KEY_BYTES = 32;

const publicKey = z.string().transform((text, ctx) => {
  const bytes = decodeBase64url(text);
  if (bytes === null || bytes.length !== PUBLIC_KEY_BYTES) {
    ctx.addIssue({ code: "custom", message: "expected a 32-byte key in base64url" });
    return z.NEVER;
  }
  return bytes;
});

const lowercaseUuid = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
const isoTime = z.iso.datetime({ offset: true });
const cursor = z.string().regex(/^[0-9]{1,20}$/);
const entryMode = z.enum(["single_use", "multi_scan"]);

const serverKeyWire = z.object({ id: z.int().min(0).max(255), publicKey });

const ticketTypeWire = z.object({
  ref: z.int().min(1).max(65_535),
  name: z.string().min(1),
  zone: z.string().min(1).nullable(),
  entryMode,
  audience: z.enum(["public", "staff", "performer"]),
});

const ticketWire = z.object({
  ticketId: lowercaseUuid,
  typeRef: z.int().min(1).max(65_535),
  entryMode,
  status: z.enum(["issued", "bound", "void"]),
  redeemed: z.boolean(),
  holderPubkey: publicKey.nullable(),
  keyVersion: z.int().min(0).max(255),
  codeHuman: z.string().regex(/^[0-9A-HJKMNP-TV-Z]{10}$/),
});

const common = {
  formatVersion: z.literal(GATE_MANIFEST_VERSION),
  eventId: lowercaseUuid,
  expiresAt: isoTime,
  serverKeys: z.array(serverKeyWire),
  ticketTypes: z.array(ticketTypeWire),
  tickets: z.array(ticketWire),
  cursor,
  serverTime: z.int().nonnegative(),
};

const gateManifestWire = z.object({
  ...common,
  event: z.object({
    name: z.string().min(1),
    venueName: z.string().min(1),
    startsAt: isoTime,
    endsAt: isoTime,
    ageRating: z.enum(["all", "12plus", "18plus"]),
  }),
  deviceZone: z.string().min(1).nullable(),
});

const gateManifestDeltaWire = z.object({ ...common, since: cursor });

/** A cursor as the API accepts it in `?since=`. */
export const manifestCursor = cursor;

function encodeKeys(keys: readonly ManifestServerKey[]) {
  return keys.map((key) => ({ id: key.id, publicKey: encodeBase64url(key.publicKey) }));
}

function encodeTickets(tickets: readonly ManifestTicket[]) {
  return tickets.map((ticket) => ({
    ...ticket,
    holderPubkey: ticket.holderPubkey === null ? null : encodeBase64url(ticket.holderPubkey),
  }));
}

/** The JSON value of a manifest. */
export function encodeGateManifest(manifest: GateManifest): unknown {
  return {
    ...manifest,
    serverKeys: encodeKeys(manifest.serverKeys),
    tickets: encodeTickets(manifest.tickets),
  };
}

/** The JSON value of a delta. */
export function encodeGateManifestDelta(delta: GateManifestDelta): unknown {
  return {
    ...delta,
    serverKeys: encodeKeys(delta.serverKeys),
    tickets: encodeTickets(delta.tickets),
  };
}

/** A manifest from untrusted JSON, or null if it does not match the format. */
export function decodeGateManifest(json: unknown): GateManifest | null {
  const parsed = gateManifestWire.safeParse(json);
  return parsed.success ? parsed.data : null;
}

/** A delta from untrusted JSON, or null if it does not match the format. */
export function decodeGateManifestDelta(json: unknown): GateManifestDelta | null {
  const parsed = gateManifestDeltaWire.safeParse(json);
  return parsed.success ? parsed.data : null;
}

/**
 * A key ring from untrusted JSON, `[{ "id": 1, "publicKey": "<base64url>" }]`, or null if
 * it does not match. Ids must be unique.
 */
export function decodeServerKeys(json: unknown): ManifestServerKey[] | null {
  const parsed = z.array(serverKeyWire).safeParse(json);
  if (!parsed.success) return null;
  const ids = new Set(parsed.data.map((key) => key.id));
  return ids.size === parsed.data.length ? parsed.data : null;
}
