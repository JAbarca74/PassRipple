// The buyer's device key (design 6.2, ADR 0032): one Ed25519 key per device and origin,
// created when the checkout opens, with a private half WebCrypto never lets out. It is kept
// in IndexedDB as the CryptoKey objects themselves, which stay non-extractable there. The
// wallet signs every QR window with it through a Signer, so @passripple/crypto never holds
// the private key (ADR 0014).

import { encodeBase64url } from "@passripple/contracts";
import type { Signer } from "@passripple/crypto";

const DB_NAME = "passripple-wallet";
const STORE = "keys";
const DEVICE = "device";

interface StoredKey {
  readonly privateKey: CryptoKey;
  readonly publicKey: Uint8Array;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function read(db: IDBDatabase): Promise<StoredKey | undefined> {
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE).objectStore(STORE).get(DEVICE);
    request.onsuccess = () => resolve(request.result as StoredKey | undefined);
    request.onerror = () => reject(request.error);
  });
}

function write(db: IDBDatabase, key: StoredKey): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(key, DEVICE);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Thrown when the browser has no Ed25519 in WebCrypto (Safari 17, Chrome 137, Firefox 129). */
export class UnsupportedBrowser extends Error {}

let cached: Promise<StoredKey> | null = null;

async function load(): Promise<StoredKey> {
  const db = await openDb();
  const existing = await read(db);
  if (existing) return existing;
  let pair: CryptoKeyPair;
  try {
    pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, false, [
      "sign",
      "verify",
    ])) as CryptoKeyPair;
  } catch {
    throw new UnsupportedBrowser("Ed25519 is not available in this browser");
  }
  const publicKey = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const stored = { privateKey: pair.privateKey, publicKey };
  await write(db, stored);
  return stored;
}

/** The device's key, created on first use. */
function deviceKey(): Promise<StoredKey> {
  cached ??= load().catch((error: unknown) => {
    cached = null;
    throw error;
  });
  return cached;
}

/** The device's public key in base64url, to bind tickets to it. */
export async function devicePublicKey(): Promise<string> {
  return encodeBase64url((await deviceKey()).publicKey);
}

/** A signer over the device's key, for presentCredential. */
export async function deviceSigner(): Promise<Signer> {
  const { privateKey, publicKey } = await deviceKey();
  return {
    publicKey,
    async sign(message) {
      return new Uint8Array(
        await crypto.subtle.sign({ name: "Ed25519" }, privateKey, new Uint8Array(message)),
      );
    },
  };
}
