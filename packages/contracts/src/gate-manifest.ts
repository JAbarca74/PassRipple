// The package a gate device downloads before an event (8.3). It holds no secret: only
// identifiers, states and public keys, so whoever extracts it from a phone cannot forge a
// credential (invariant I7).
//
// Draft from Phase 1, where it shapes the fixture of the I7 test. Phase 2 builds it from
// the database, decides how it travels and is stored, and adds incremental updates.
// Attendee data (Phase 7), door-sale blocks and courtesy quotas join it in later phases.

import type { EntryMode } from "./credential-format.ts";

export const GATE_MANIFEST_VERSION = 1;

/** One of the server's public keys valid for the event's credentials. */
export interface ManifestServerKey {
  /** 0 to 255, as written in each certificate. */
  readonly id: number;
  /** 32-byte Ed25519 public key. */
  readonly publicKey: Uint8Array;
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

export interface GateManifest {
  readonly formatVersion: typeof GATE_MANIFEST_VERSION;
  /** Lowercase UUID of the event. */
  readonly eventId: string;
  /** ISO 8601. After this the device deletes the event's data (8.3). */
  readonly expiresAt: string;
  /** The server keys a device trusts for this event: its key ring. */
  readonly serverKeys: readonly ManifestServerKey[];
  readonly tickets: readonly ManifestTicket[];
}
