// What the gate decides about a scanned QR (design 6.3). Steps 1 to 3 are
// crypto.verifyCredential: format, server key and signature, device key and signature,
// window around the corrected clock, event. Step 4 is the manifest: not redeemed, not void,
// not superseded by a newer binding. A credential that verifies but whose ticket is missing
// from the manifest (bought after the download) is admitted and flagged for reconciliation.

import type { ManifestTicketType } from "@passripple/contracts";
import {
  type RejectionReason,
  type ServerKeyRing,
  type VerifiedCredential,
  verifyCredential,
} from "@passripple/crypto";
import { perfLog, perfNow } from "../perf.ts";
import type { StoredTicket } from "./manifest-store.ts";

/** Why the gate refused a ticket, after the cryptography or in the manifest. */
export type GateRejection =
  | RejectionReason
  | "malformed"
  | "already_redeemed"
  | "void"
  | "stale_key"
  | "wrong_zone"
  | "gate_closed";

export type GateDecision =
  | {
      readonly kind: "admit";
      readonly ticketId: string;
      readonly typeRef: number;
      readonly keyVersion: number;
      readonly entryMode: "single_use" | "multi_scan";
      readonly typeName: string;
      /** False when the ticket was not in the manifest (6.3): admitted and reconciled later. */
      readonly inManifest: boolean;
      readonly holderPubkey: Uint8Array | null;
    }
  | {
      readonly kind: "reject";
      readonly reason: GateRejection;
      readonly ticketId: string | null;
      readonly typeName: string | null;
    };

export interface GateLookups {
  readonly serverKeys: ServerKeyRing;
  readonly eventId: string;
  readonly ticketTypes: ReadonlyMap<number, ManifestTicketType>;
  readonly ticket: (ticketId: string) => Promise<StoredTicket | null>;
}

/** Step 4 of 6.3 for a ticket the device found, by QR or by its code. */
export function checkManifest(
  ticket: StoredTicket,
  typeName: string,
  credential: Pick<VerifiedCredential, "keyVersion" | "holderPubkey"> | null,
): GateDecision {
  const base = { ticketId: ticket.ticketId, typeName };
  if (ticket.status === "void") return { kind: "reject", reason: "void", ...base };
  if (credential !== null && credential.keyVersion < ticket.keyVersion) {
    // The ticket was transferred or recovered: this certificate belongs to the old phone.
    return { kind: "reject", reason: "stale_key", ...base };
  }
  if (ticket.entryMode === "single_use" && ticket.redeemed) {
    return { kind: "reject", reason: "already_redeemed", ...base };
  }
  return {
    kind: "admit",
    ...base,
    typeRef: ticket.typeRef,
    keyVersion: credential?.keyVersion ?? ticket.keyVersion,
    entryMode: ticket.entryMode,
    inManifest: true,
    holderPubkey: credential?.holderPubkey ?? ticket.holderPubkey,
  };
}

export async function decideQr(
  qr: string,
  lookups: GateLookups,
  nowMs: number,
): Promise<GateDecision> {
  const verifyStart = perfNow();
  const verdict = verifyCredential(
    qr.trim(),
    { serverKeys: lookups.serverKeys, eventId: lookups.eventId },
    nowMs,
  );
  perfLog("verify_ms", perfNow() - verifyStart);
  if (!verdict.ok)
    return { kind: "reject", reason: verdict.reason, ticketId: null, typeName: null };
  const { credential } = verdict;

  // Ticket types of other zones are not in this device's manifest (8.2).
  const type = lookups.ticketTypes.get(credential.typeRef);
  if (type === undefined) {
    return { kind: "reject", reason: "wrong_zone", ticketId: credential.ticketId, typeName: null };
  }

  const ticket = await lookups.ticket(credential.ticketId);
  if (ticket === null) {
    return {
      kind: "admit",
      ticketId: credential.ticketId,
      typeRef: credential.typeRef,
      keyVersion: credential.keyVersion,
      entryMode: credential.entryMode,
      typeName: type.name,
      inManifest: false,
      holderPubkey: credential.holderPubkey,
    };
  }
  return checkManifest(ticket, type.name, credential);
}

/** What the operator reads for each refusal. */
export const REJECTION_TEXT: Readonly<Record<GateRejection, string>> = {
  malformed: "Este código no es una entrada de PassRipple.",
  unknown_server_key: "Entrada firmada con una llave que este teléfono no conoce.",
  bad_server_signature: "Entrada falsificada: la firma no es válida.",
  weak_holder_key: "Entrada falsificada: llave inválida.",
  bad_holder_signature: "Entrada copiada: no viene del teléfono dueño.",
  stale_window:
    "Código vencido: puede ser una captura de pantalla. Pida abrir la entrada de nuevo.",
  future_window: "La hora del teléfono del comprador está adelantada. Pida corregirla.",
  wrong_event: "Esta entrada es de otro evento.",
  wrong_zone: "Esta entrada es de otra zona.",
  already_redeemed: "Esta entrada ya se usó.",
  void: "Esta entrada fue anulada.",
  stale_key: "La entrada fue transferida a otro teléfono. Esta copia ya no vale.",
  gate_closed: "Este teléfono ya no valida: el evento terminó o el acceso fue revocado.",
};
