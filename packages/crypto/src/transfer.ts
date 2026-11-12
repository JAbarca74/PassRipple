// Proof that a transfer offer comes from the phone holding the ticket (design 6.6). The
// order's token alone is not enough: a buyer may forward the order link, and whoever opens
// it must not be able to give the tickets away. The holder signs the ticket, its current
// key version and the time with the device key; the Worker checks the signature against
// the key the ticket is bound to, and accepts it for a few minutes only.

import { concatBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { SIGNATURE_LENGTH, uuidToBytes } from "@passripple/contracts";
import { isAcceptableHolderKey, verifyStrict } from "./bytes.ts";
import type { Signer } from "./signer.ts";

const TRANSFER_TAG = utf8ToBytes("PassRipple/transfer/v1");

/** How far a proof's time may be from the server's, either way. */
export const TRANSFER_PROOF_MAX_SKEW_SECONDS = 300;

/** What a holder signs to offer one ticket. */
export interface TransferProofInput {
  /** Lowercase UUID. */
  readonly ticketId: string;
  /** The ticket's current key version, 1 to 5. */
  readonly keyVersion: number;
  /** Unix time in whole seconds. */
  readonly issuedAt: number;
}

function message(input: TransferProofInput): Uint8Array {
  const { keyVersion, issuedAt } = input;
  if (!Number.isInteger(keyVersion) || keyVersion < 1 || keyVersion > 5) {
    throw new RangeError("keyVersion must be an integer from 1 to 5");
  }
  if (!Number.isInteger(issuedAt) || issuedAt < 0 || issuedAt > 0xffffffff) {
    throw new RangeError("issuedAt must be a whole number of seconds that fits in 32 bits");
  }
  const tail = new Uint8Array(5);
  const view = new DataView(tail.buffer);
  view.setUint8(0, keyVersion);
  view.setUint32(1, issuedAt);
  return concatBytes(TRANSFER_TAG, uuidToBytes(input.ticketId), tail);
}

/** The holder's 64-byte signature over the offer. */
export async function signTransferProof(
  input: TransferProofInput,
  holder: Signer,
): Promise<Uint8Array> {
  const signed = message(input);
  const signature = await holder.sign(signed);
  if (signature.length !== SIGNATURE_LENGTH || !verifyStrict(signature, signed, holder.publicKey)) {
    throw new Error("the device produced a signature that does not verify");
  }
  return signature;
}

/**
 * Whether a signature proves that the holder of `holderPubkey` offered this ticket at this
 * key version, within the allowed skew of `nowSeconds`.
 */
export function verifyTransferProof(
  input: TransferProofInput,
  signature: Uint8Array,
  holderPubkey: Uint8Array,
  nowSeconds: number,
): boolean {
  if (signature.length !== SIGNATURE_LENGTH || !isAcceptableHolderKey(holderPubkey)) return false;
  if (Math.abs(nowSeconds - input.issuedAt) > TRANSFER_PROOF_MAX_SKEW_SECONDS) return false;
  let signed: Uint8Array;
  try {
    signed = message(input);
  } catch {
    return false;
  }
  return verifyStrict(signature, signed, holderPubkey);
}
