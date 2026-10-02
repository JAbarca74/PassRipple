// Scanning at gate pace (design 6.5, 9.6). The camera reads the same QR many times a
// second, so a code seen again within a few seconds is ignored instead of turning green
// into "already used". A buyer's tickets share one device key, so consecutive admissions
// with the same key form a burst, shown as "3 of 4 valid", where 4 is how many usable
// tickets that key holds in the manifest.

/** Repeated reads of the same text within this time are ignored. */
export const REPEAT_WINDOW_MS = 4_000;
/** Admissions of the same key closer than this belong to one burst. */
export const BURST_GAP_MS = 8_000;

export interface Burst {
  readonly admitted: number;
  readonly total: number;
}

function sameKey(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, index) => byte === b[index]);
}

export class ScanSession {
  private lastText: string | null = null;
  private lastTextAt = 0;
  private burstKey: Uint8Array | null = null;
  private burstAt = 0;
  private burstTickets = new Set<string>();

  /** Whether a read is new, or the camera seeing the same code again. */
  isNewRead(text: string, nowMs: number): boolean {
    if (text === this.lastText && nowMs - this.lastTextAt < REPEAT_WINDOW_MS) {
      this.lastTextAt = nowMs;
      return false;
    }
    this.lastText = text;
    this.lastTextAt = nowMs;
    return true;
  }

  /** Counts an admission toward its holder's burst; `total` comes from the manifest. */
  admitted(
    ticketId: string,
    holderPubkey: Uint8Array | null,
    total: number,
    nowMs: number,
  ): Burst | null {
    if (holderPubkey === null) {
      this.burstKey = null;
      return null;
    }
    const continues =
      this.burstKey !== null &&
      sameKey(this.burstKey, holderPubkey) &&
      nowMs - this.burstAt < BURST_GAP_MS;
    if (!continues) {
      this.burstKey = holderPubkey;
      this.burstTickets = new Set();
    }
    this.burstTickets.add(ticketId);
    this.burstAt = nowMs;
    return { admitted: this.burstTickets.size, total: Math.max(total, this.burstTickets.size) };
  }
}

/**
 * Failed manual entries per device (design 6.7): the code is static, so guessing is
 * limited. After five failures, entry locks for a minute, doubling on each lock after.
 */
export class ManualEntryLimiter {
  static readonly MAX_FAILURES = 5;
  static readonly BASE_LOCK_MS = 60_000;

  private failures = 0;
  private locks = 0;
  private lockedUntil = 0;

  lockedFor(nowMs: number): number {
    return Math.max(0, this.lockedUntil - nowMs);
  }

  /** Records a failure. Returns true when it locks entry. */
  fail(nowMs: number): boolean {
    this.failures += 1;
    if (this.failures < ManualEntryLimiter.MAX_FAILURES) return false;
    this.failures = 0;
    this.lockedUntil = nowMs + ManualEntryLimiter.BASE_LOCK_MS * 2 ** this.locks;
    this.locks += 1;
    return true;
  }

  succeed(): void {
    this.failures = 0;
  }
}
