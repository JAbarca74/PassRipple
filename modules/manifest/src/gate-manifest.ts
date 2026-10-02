// Builds a gate manifest from what the manifest functions return (db/migrations/
// 0002_gate_manifest.sql) and the server's public key ring. Pure: the caller runs the
// queries, reads the clock and passes the keys.

import type {
  AgeRating,
  EntryMode,
  GateManifest,
  GateManifestDelta,
  ManifestServerKey,
  ManifestTicket,
  ManifestTicketType,
  TicketAudience,
} from "@passripple/contracts";
import { GATE_MANIFEST_VERSION } from "@passripple/contracts";

/** A row of manifest.gate_event. */
export interface GateEventRow {
  readonly event_id: string;
  readonly name: string;
  readonly venue_name: string;
  readonly starts_at: Date;
  readonly ends_at: Date;
  readonly age_rating: AgeRating;
  readonly device_zone: string | null;
}

/** A row of manifest.gate_ticket_types. */
export interface GateTicketTypeRow {
  readonly ref: number;
  readonly name: string;
  readonly zone: string | null;
  readonly entry_mode: EntryMode;
  readonly audience: TicketAudience;
}

/** A row of manifest.gate_tickets. */
export interface GateTicketRow {
  readonly ticket_id: string;
  readonly type_ref: number;
  readonly entry_mode: EntryMode;
  readonly status: ManifestTicket["status"];
  readonly redeemed: boolean;
  readonly holder_pubkey: Uint8Array | null;
  readonly key_version: number;
  readonly code_human: string;
}

export interface GateManifestInput {
  readonly event: GateEventRow;
  readonly serverKeys: readonly ManifestServerKey[];
  readonly ticketTypes: readonly GateTicketTypeRow[];
  readonly tickets: readonly GateTicketRow[];
  /** manifest.cursor(), read before the tickets. */
  readonly cursor: string;
  readonly serverTime: number;
}

const KEY_BYTES = 32;

function checkKeys(keys: readonly ManifestServerKey[]): readonly ManifestServerKey[] {
  for (const key of keys) {
    if (
      key.publicKey.length !== KEY_BYTES ||
      !Number.isInteger(key.id) ||
      key.id < 0 ||
      key.id > 255
    ) {
      throw new RangeError(`server key ${key.id} is not a 32-byte Ed25519 public key with an id`);
    }
  }
  return keys;
}

function ticketType(row: GateTicketTypeRow): ManifestTicketType {
  return {
    ref: row.ref,
    name: row.name,
    zone: row.zone,
    entryMode: row.entry_mode,
    audience: row.audience,
  };
}

function ticket(row: GateTicketRow): ManifestTicket {
  return {
    ticketId: row.ticket_id,
    typeRef: row.type_ref,
    entryMode: row.entry_mode,
    status: row.status,
    redeemed: row.redeemed,
    // Copied, so the manifest never shares a buffer with the database driver.
    holderPubkey: row.holder_pubkey === null ? null : Uint8Array.from(row.holder_pubkey),
    keyVersion: row.key_version,
    codeHuman: row.code_human,
  };
}

/** The whole manifest for a device. It expires when the event's window ends. */
export function buildGateManifest(input: GateManifestInput): GateManifest {
  const { event } = input;
  return {
    formatVersion: GATE_MANIFEST_VERSION,
    eventId: event.event_id,
    event: {
      name: event.name,
      venueName: event.venue_name,
      startsAt: event.starts_at.toISOString(),
      endsAt: event.ends_at.toISOString(),
      ageRating: event.age_rating,
    },
    deviceZone: event.device_zone,
    expiresAt: event.ends_at.toISOString(),
    serverKeys: checkKeys(input.serverKeys),
    ticketTypes: input.ticketTypes.map(ticketType),
    tickets: input.tickets.map(ticket),
    cursor: input.cursor,
    serverTime: input.serverTime,
  };
}

/** What changed for a device since `since`. */
export function buildGateManifestDelta(
  input: GateManifestInput & { readonly since: string },
): GateManifestDelta {
  return {
    formatVersion: GATE_MANIFEST_VERSION,
    eventId: input.event.event_id,
    since: input.since,
    expiresAt: input.event.ends_at.toISOString(),
    serverKeys: checkKeys(input.serverKeys),
    ticketTypes: input.ticketTypes.map(ticketType),
    tickets: input.tickets.map(ticket),
    cursor: input.cursor,
    serverTime: input.serverTime,
  };
}
