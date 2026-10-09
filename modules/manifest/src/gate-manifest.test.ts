import { decodeGateManifest, encodeGateManifest } from "@passripple/contracts";
import { describe, expect, test } from "vitest";
import {
  buildGateManifest,
  buildGateManifestDelta,
  type GateEventRow,
  type GateTicketRow,
  type GateTicketTypeRow,
} from "./gate-manifest.ts";

describe("gate-manifest builder", () => {
  const event: GateEventRow = {
    event_id: "12345678-1234-1234-1234-123456789012",
    name: "My Event",
    venue_name: "My Venue",
    starts_at: new Date("2024-01-01T10:00:00Z"),
    ends_at: new Date("2024-01-01T23:00:00Z"),
    age_rating: "all",
    device_zone: "Zone 1",
  };

  const ticketTypes: GateTicketTypeRow[] = [
    {
      ref: 1,
      name: "General",
      zone: "Zone 1",
      entry_mode: "single_use",
      audience: "public",
    },
  ];

  const tickets: GateTicketRow[] = [
    {
      ticket_id: "87654321-4321-4321-4321-210987654321",
      type_ref: 1,
      entry_mode: "single_use",
      status: "issued",
      redeemed: false,
      holder_pubkey: new Uint8Array(32).fill(1),
      key_version: 1,
      code_human: "ABCDEFGHJK",
    },
  ];

  const serverKeys = [{ id: 1, publicKey: new Uint8Array(32).fill(2) }];

  const input = {
    event,
    serverKeys,
    ticketTypes,
    tickets,
    cursor: "100",
    serverTime: 1700000000000,
  };

  describe("buildGateManifest", () => {
    test("translates snake_case to camelCase and converts dates to ISO string", () => {
      const manifest = buildGateManifest(input);

      expect(manifest.formatVersion).toBe(1);
      expect(manifest.eventId).toBe(event.event_id);
      expect(manifest.event.name).toBe(event.name);
      expect(manifest.event.startsAt).toBe("2024-01-01T10:00:00.000Z");
      expect(manifest.event.endsAt).toBe("2024-01-01T23:00:00.000Z");
      expect(manifest.expiresAt).toBe(manifest.event.endsAt);
      expect(manifest.deviceZone).toBe(event.device_zone);

      expect(manifest.cursor).toBe(input.cursor);
      expect(manifest.serverTime).toBe(input.serverTime);

      const mt0 = manifest.ticketTypes[0];
      const tt0 = ticketTypes[0];
      if (!mt0 || !tt0) throw new Error("ticketTypes[0] missing");
      expect(mt0.entryMode).toBe(tt0.entry_mode);

      const mtk0 = manifest.tickets[0];
      const tk0 = tickets[0];
      if (!mtk0 || !tk0) throw new Error("tickets[0] missing");
      expect(mtk0.entryMode).toBe(tk0.entry_mode);
      expect(mtk0.ticketId).toBe(tk0.ticket_id);
      expect(mtk0.holderPubkey).toEqual(tk0.holder_pubkey);
    });

    test("copies the holder public key buffer so later mutation does not affect manifest", () => {
      const buffer = new Uint8Array(32).fill(1);
      const m = buildGateManifest({
        ...input,
        tickets: [{ ...tickets[0]!, holder_pubkey: buffer }],
      });

      buffer[0] = 99; // mutate original

      const mtk0 = m.tickets[0];
      if (!mtk0) throw new Error("m.tickets[0] missing");
      const pk = mtk0.holderPubkey;
      if (!pk) throw new Error("holderPubkey missing");
      expect(pk[0]).toBe(1); // copy remains 1
    });

    test("throws RangeError on invalid server keys", () => {
      // 31 bytes
      expect(() =>
        buildGateManifest({ ...input, serverKeys: [{ id: 1, publicKey: new Uint8Array(31) }] }),
      ).toThrow(RangeError);
      // id out of bounds
      expect(() =>
        buildGateManifest({ ...input, serverKeys: [{ id: 256, publicKey: new Uint8Array(32) }] }),
      ).toThrow(RangeError);
      expect(() =>
        buildGateManifest({ ...input, serverKeys: [{ id: -1, publicKey: new Uint8Array(32) }] }),
      ).toThrow(RangeError);
    });

    test("round trips through encode and decode GateManifest", () => {
      const manifest = buildGateManifest(input);
      const encoded = encodeGateManifest(manifest);
      const decoded = decodeGateManifest(encoded);
      expect(decoded).toEqual(manifest);
    });
  });

  describe("buildGateManifestDelta", () => {
    test("includes since and does not include event", () => {
      const delta = buildGateManifestDelta({ ...input, since: "50" });

      expect(delta.since).toBe("50");
      expect("event" in delta).toBe(false);
      expect(delta.expiresAt).toBe(event.ends_at.toISOString());
      const tk0 = delta.tickets[0];
      const origTk0 = tickets[0];
      if (!tk0 || !origTk0) throw new Error("tickets[0] missing");
      expect(tk0.ticketId).toBe(origTk0.ticket_id);
    });
  });
});
