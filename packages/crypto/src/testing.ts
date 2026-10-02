import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { utf8ToBytes } from "@noble/hashes/utils.js";
import type { ServerSigner, Signer } from "./signer.ts";
export function getSeed(label: string): Uint8Array {
  return sha256(utf8ToBytes(label));
}

export function createSigner(label: string): Signer & { seed: Uint8Array } {
  const seed = getSeed(label);
  const publicKey = ed25519.getPublicKey(seed);
  return {
    seed,
    publicKey,
    async sign(this: any, message: Uint8Array) {
      return ed25519.sign(message, this.seed);
    },
  };
}

export function createServerSigner(label: string, keyId: number): ServerSigner & { seed: Uint8Array } {
  return {
    ...createSigner(label),
    keyId,
  };
}
