// Randomness for the gate app, from the platform's secure generator. Pure packages take
// random bytes as parameters; this is where they are drawn.

import { uuidv7 } from "@passripple/contracts";
import type { Random } from "@passripple/outbox";
import { getRandomBytes, getRandomValues } from "expo-crypto";

export function randomHex(byteCount: number): string {
  return Array.from(getRandomBytes(byteCount), (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

/** A UUIDv7 for an operation recorded now (device wall clock). */
export function newOperationId(nowMs: number): string {
  return uuidv7(Math.floor(nowMs), getRandomBytes(10));
}

/** Uniform numbers in [0, 1) for the outbox's jitter. */
export const secureRandom: Random = {
  next() {
    const [value] = getRandomValues(new Uint32Array(1));
    return (value ?? 0) / 2 ** 32;
  },
};
