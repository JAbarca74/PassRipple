// UUIDs as the 16 bytes they stand for. The text form is always lowercase.

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The 16 bytes of a lowercase UUID. Anything else is a programming error, so it throws. */
export function uuidToBytes(uuid: string): Uint8Array {
  if (!UUID_PATTERN.test(uuid)) throw new RangeError("expected a lowercase UUID");
  const hex = uuid.replaceAll("-", "");
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/** The lowercase UUID text of 16 bytes. */
export function bytesToUuid(bytes: Uint8Array): string {
  if (bytes.length !== 16) throw new RangeError(`expected 16 bytes, got ${bytes.length}`);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * A UUIDv7 (RFC 9562): 48 bits of Unix milliseconds, then 74 random bits taken from the 10
 * bytes the caller drew. Ids made this way sort by time and do not fragment an index. This
 * package reads no clock and draws no randomness, so both are parameters.
 */
export function uuidv7(ms: number, random: Uint8Array): string {
  if (!Number.isInteger(ms) || ms < 0 || ms > 0xffff_ffff_ffff) {
    throw new RangeError(`not a 48-bit millisecond time: ${ms}`);
  }
  if (random.length !== 10) throw new RangeError(`expected 10 random bytes, got ${random.length}`);
  const bytes = new Uint8Array(16);
  let time = ms;
  for (let i = 5; i >= 0; i--) {
    bytes[i] = time % 256;
    time = Math.floor(time / 256);
  }
  bytes[6] = 0x70 | ((random[0] ?? 0) & 0x0f);
  bytes[7] = random[1] ?? 0;
  bytes[8] = 0x80 | ((random[2] ?? 0) & 0x3f);
  bytes.set(random.subarray(3, 10), 9);
  return bytesToUuid(bytes);
}
