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
