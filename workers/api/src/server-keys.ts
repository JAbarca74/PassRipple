// The server's keys (design 6.8, ADR 0014, 0035). The public key ring is configuration that
// gate devices and wallets receive; the private key that signs certificates is a Worker
// secret, wrapped in a ServerSigner so @passripple/crypto never holds it. Locally it is the
// development key derived from a public label (scripts/dev-fixtures.ts); the production key
// is still an open decision and is never generated here.

import { decodeBase64url, decodeServerKeys, type ManifestServerKey } from "@passripple/contracts";
import type { ServerSigner } from "@passripple/crypto";
import { type Env, required } from "./env.ts";

/** The public key ring in SERVER_PUBLIC_KEYS. */
export function serverKeys(env: Env): ManifestServerKey[] {
  let json: unknown;
  try {
    json = JSON.parse(required(env, "SERVER_PUBLIC_KEYS"));
  } catch {
    json = null;
  }
  const keys = decodeServerKeys(json);
  if (keys === null) throw new Error("SERVER_PUBLIC_KEYS is not a valid key ring");
  return keys;
}

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

const signers = new Map<string, Promise<ServerSigner>>();

async function importSigner(
  seed: string,
  keyId: number,
  publicKey: Uint8Array,
): Promise<ServerSigner> {
  const d = decodeBase64url(seed);
  if (d === null || d.length !== 32) {
    throw new Error("SERVER_SIGNING_KEY must be a 32-byte Ed25519 seed in base64url");
  }
  // A JWK needs the public half too; it comes from the ring, so a seed that does not match
  // its id fails at the first signature (signCertificate checks it).
  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: "OKP", crv: "Ed25519", d: base64url(d), x: base64url(publicKey) },
    { name: "Ed25519" },
    false,
    ["sign"],
  );
  return {
    keyId,
    publicKey,
    async sign(message) {
      return new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, key, message));
    },
  };
}

/**
 * The signer of the key in SERVER_SIGNING_KEY, whose id is SERVER_SIGNING_KEY_ID and whose
 * public key must be in the ring. Built once per isolate.
 */
export function serverSigner(env: Env): Promise<ServerSigner> {
  const seed = required(env, "SERVER_SIGNING_KEY");
  const keyId = Number(required(env, "SERVER_SIGNING_KEY_ID"));
  if (!Number.isInteger(keyId) || keyId < 0 || keyId > 255) {
    throw new Error("SERVER_SIGNING_KEY_ID must be a key id from 0 to 255");
  }
  const cacheKey = `${keyId}:${seed}`;
  let signer = signers.get(cacheKey);
  if (!signer) {
    const ring = serverKeys(env).find((key) => key.id === keyId);
    if (!ring) throw new Error(`SERVER_SIGNING_KEY_ID ${keyId} is not in SERVER_PUBLIC_KEYS`);
    signer = importSigner(seed, keyId, ring.publicKey);
    signers.set(cacheKey, signer);
    signer.catch(() => signers.delete(cacheKey));
  }
  return signer;
}
