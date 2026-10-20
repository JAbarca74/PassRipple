// The wallet's calls (ADR 0030, 0032, 0036): read an order's tickets, bind them to this
// device, and recover them on a new one. Presenting a ticket signs the current window with
// the device key; the server's certificate is checked against the ring first.

import {
  decodeBase64url,
  decodeCertificate,
  type RecoveryVerifyResponse,
  type WalletView,
} from "@passripple/contracts";
import { presentCredential, type ServerKeyRing, verifyCertificate } from "@passripple/crypto";
import { api, serverNow } from "./api.ts";
import { devicePublicKey, deviceSigner } from "./device-key.ts";

export function readWallet(token: string): Promise<WalletView> {
  return api<WalletView>("/wallet", { token });
}

/** Ties the order's unbound tickets (or, with a recovery token, all of them) to this device. */
export async function bindWallet(token: string): Promise<WalletView> {
  return api<WalletView>("/wallet/bind", {
    method: "POST",
    token,
    body: { publicKey: await devicePublicKey() },
  });
}

/** Whether a ticket is bound to this device's key. */
export async function heldHere(holderKey: string | null): Promise<boolean> {
  return holderKey !== null && holderKey === (await devicePublicKey());
}

function ring(view: WalletView): ServerKeyRing {
  const keys = new Map<number, Uint8Array>();
  for (const key of view.serverKeys) {
    const bytes = decodeBase64url(key.publicKey);
    if (bytes) keys.set(key.id, bytes);
  }
  return keys;
}

/** The QR text of a ticket for the current 30-second window, or null if it cannot be shown. */
export async function presentTicket(view: WalletView, certificate: string): Promise<string | null> {
  const bytes = decodeBase64url(certificate);
  if (!bytes) return null;
  const decoded = decodeCertificate(bytes);
  if (!decoded.ok || !verifyCertificate(decoded.value, ring(view))) return null;
  try {
    return await presentCredential(decoded.value, await deviceSigner(), serverNow());
  } catch {
    // The certificate names another device's key: the ticket was moved elsewhere.
    return null;
  }
}

export function requestRecoveryCode(contact: string): Promise<unknown> {
  return api("/wallet/recovery", { method: "POST", body: { contact } });
}

export function verifyRecoveryCode(contact: string, code: string): Promise<RecoveryVerifyResponse> {
  return api<RecoveryVerifyResponse>("/wallet/recovery/verify", {
    method: "POST",
    body: { contact, code },
  });
}
