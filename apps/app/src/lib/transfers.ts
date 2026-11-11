// Free transfers (design 6.6). The holder signs the offer with the device key, so only the
// phone holding a ticket can give it away. The link carries the offer's secret after `#`,
// which browsers never send to a server. The receiver's token reaches that one ticket; it
// stays in this origin like an order's token (lib/orders.ts).

import {
  type AttendeeDocType,
  type AttendeeView,
  type ClaimResponse,
  encodeBase64url,
  type HeldView,
  type TransferOffered,
  type TransferPreview,
  type TransferProof,
} from "@passripple/contracts";
import { signTransferProof } from "@passripple/crypto";
import { api, serverNow } from "./api.ts";
import { devicePublicKey, deviceSigner } from "./device-key.ts";

const KEY = "passripple.held";

/** A ticket this device received by transfer. */
export interface HeldTicket {
  readonly token: string;
  /** What the wallet's routes call it: `R` and the start of the token's random part. */
  readonly code: string;
  readonly eventName: string;
}

export function heldTickets(): HeldTicket[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(parsed) ? (parsed as HeldTicket[]) : [];
  } catch {
    return [];
  }
}

function keepHeld(ticket: HeldTicket): void {
  try {
    const others = heldTickets().filter((kept) => kept.code !== ticket.code);
    localStorage.setItem(KEY, JSON.stringify([ticket, ...others]));
  } catch {
    // Private mode or full storage: the ticket still works in this tab.
  }
}

export function readHeld(token: string): Promise<HeldView> {
  return api<HeldView>("/transfers/held", { token });
}

async function proof(ticketId: string, keyVersion: number): Promise<TransferProof> {
  const issuedAt = Math.floor(serverNow() / 1000);
  const signature = await signTransferProof(
    { ticketId, keyVersion, issuedAt },
    await deviceSigner(),
  );
  return {
    ticketId,
    publicKey: await devicePublicKey(),
    issuedAt,
    signature: encodeBase64url(signature),
  };
}

/** Offers a ticket held here; `token` is its order's or its receiver's. */
export async function offerTransfer(
  token: string,
  ticketId: string,
  keyVersion: number,
): Promise<TransferOffered> {
  return api<TransferOffered>("/transfers", {
    method: "POST",
    token,
    body: await proof(ticketId, keyVersion),
  });
}

export async function cancelTransfer(
  token: string,
  ticketId: string,
  keyVersion: number,
): Promise<void> {
  await api("/transfers/cancel", {
    method: "POST",
    token,
    body: await proof(ticketId, keyVersion),
  });
}

/** Names the attendee of a ticket held here (design 7.3), signed like a transfer. */
export async function assignAttendee(
  token: string,
  ticketId: string,
  keyVersion: number,
  attendee: { fullName: string; docType: AttendeeDocType; docNumber: string },
): Promise<AttendeeView> {
  return api<AttendeeView>("/attendees", {
    method: "POST",
    token,
    body: { ...(await proof(ticketId, keyVersion)), ...attendee },
  });
}

/** The link the receiver opens. */
export function transferLink(offerToken: string): string {
  return `${window.location.origin}/recibir#${offerToken}`;
}

export function previewTransfer(offerToken: string): Promise<TransferPreview> {
  return api<TransferPreview>("/transfers/preview", { method: "POST", body: { offerToken } });
}

/**
 * Moves the ticket to this device and keeps the receiver's token. With an email, the
 * receiver can recover the ticket on another phone later.
 */
export async function claimTransfer(
  offerToken: string,
  eventName: string,
  email?: string,
): Promise<HeldTicket> {
  const { token } = await api<ClaimResponse>("/transfers/claim", {
    method: "POST",
    body: { offerToken, publicKey: await devicePublicKey(), ...(email ? { email } : {}) },
  });
  return remember(token, eventName);
}

/** After recovery by email: moves a received ticket to this device and keeps its token. */
export async function bindHeld(token: string, eventName: string): Promise<HeldView> {
  const view = await api<HeldView>("/transfers/held/bind", {
    method: "POST",
    token,
    body: { publicKey: await devicePublicKey() },
  });
  remember(token, eventName);
  return view;
}

function remember(token: string, eventName: string): HeldTicket {
  const held = { token, code: `R${token.slice(4, 12)}`, eventName };
  keepHeld(held);
  return held;
}
