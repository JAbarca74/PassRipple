// The gate device's corrected clock (design 6.3, step 3; ADR 0024). Credentials are
// accepted within ±2 windows of 30 s around it, so a phone whose clock is off by minutes
// would reject valid tickets.
//
// Every API response carries the server's clock. Each response gives a sample: the server
// time, and the monotonic time halfway through the request. The sample with the shortest
// round trip among the last eight is the anchor, and the corrected time is the anchor's
// server time plus the monotonic time elapsed since, so changing the phone's wall clock
// while the app runs changes nothing. Across restarts the app starts from the last offset
// to the wall clock, saved with the event's data.

export interface ClockSnapshot {
  /** Corrected time minus device wall time, in milliseconds. */
  readonly offsetMs: number;
  /** Round trip of the sample it came from, in milliseconds. */
  readonly rttMs: number;
  /** Device wall time when it was taken. */
  readonly sampledAt: number;
}

interface Sample {
  readonly serverTime: number;
  readonly midPerf: number;
  readonly rttMs: number;
}

const MAX_SAMPLES = 8;
// A round trip longer than this says little about the server's clock.
const MAX_RTT_MS = 10_000;

function monotonic(): number {
  return performance.now();
}

export class DeviceClock {
  private samples: Sample[] = [];
  private anchor: Sample | null = null;
  private stored: ClockSnapshot | null;

  constructor(stored: ClockSnapshot | null = null) {
    this.stored = stored;
  }

  /** Starts from a saved correction, until the first server sample of this run. */
  restore(snapshot: ClockSnapshot): void {
    this.stored = snapshot;
  }

  /** Records a response: the server's time and when the request started and ended (monotonic). */
  sample(serverTime: number, sentPerf: number, receivedPerf: number): void {
    const rttMs = receivedPerf - sentPerf;
    if (!Number.isFinite(serverTime) || serverTime <= 0 || rttMs < 0 || rttMs > MAX_RTT_MS) return;
    this.samples.push({ serverTime, midPerf: (sentPerf + receivedPerf) / 2, rttMs });
    if (this.samples.length > MAX_SAMPLES) this.samples.shift();
    let best = this.samples[0] ?? null;
    for (const candidate of this.samples) {
      if (best === null || candidate.rttMs < best.rttMs) best = candidate;
    }
    this.anchor = best;
  }

  /** Milliseconds since the epoch, by the server's clock as well as the device knows it. */
  now(): number {
    if (this.anchor !== null) return this.anchor.serverTime + (monotonic() - this.anchor.midPerf);
    return Date.now() + (this.stored?.offsetMs ?? 0);
  }

  /** The current correction to the wall clock, recorded with every operation. */
  offsetMs(): number {
    return Math.round(this.now() - Date.now());
  }

  /** Whether a server sample was taken since the app started. */
  isSynced(): boolean {
    return this.anchor !== null;
  }

  /** What to save so the next start begins corrected. */
  snapshot(): ClockSnapshot | null {
    if (this.anchor === null) return this.stored;
    return { offsetMs: this.offsetMs(), rttMs: this.anchor.rttMs, sampledAt: Date.now() };
  }

  /** The monotonic clock, for timing requests. */
  static monotonic(): number {
    return monotonic();
  }
}
