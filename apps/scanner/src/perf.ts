// Timing log for the field test (Phase 2, ADR 0022: verification time and camera read rate).
// Off unless the build sets EXPO_PUBLIC_FIELD_PERF=1, which only the "scanner-field-apk"
// workflow does. Lines start with "[PERF]" so they can be read from `adb logcat`, and the
// same numbers feed `perfSummary()`, which the gate screen shows on top of the camera.
export const FIELD_PERF = process.env.EXPO_PUBLIC_FIELD_PERF === "1";

const verifyTimes: number[] = [];
const scanTimes: number[] = [];
const cameraEvents: number[] = [];

export function perfNow(): number {
  return performance.now();
}

export function perfLog(kind: string, value: number | string): void {
  if (!FIELD_PERF) return;
  console.log(`[PERF] ${kind}=${typeof value === "number" ? value.toFixed(2) : value}`);
  if (typeof value !== "number") return;
  if (kind === "verify_ms") verifyTimes.push(value);
  else if (kind === "scan_total_ms") scanTimes.push(value);
  else if (kind === "camera_event") {
    cameraEvents.push(value);
    if (cameraEvents.length > 200) cameraEvents.shift();
  }
}

function stats(values: readonly number[]): string {
  if (values.length === 0) return "-";
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  return `n=${values.length} med ${median.toFixed(1)} avg ${mean.toFixed(1)} max ${(sorted[sorted.length - 1] ?? 0).toFixed(1)}`;
}

/** Camera reads per second over the last second of events. */
function cameraRate(): string {
  const last = cameraEvents[cameraEvents.length - 1];
  if (last === undefined) return "-";
  return String(cameraEvents.filter((time) => last - time <= 1_000).length);
}

/** Field-test overlay text, or null in any other build. */
export function perfSummary(): string | null {
  if (!FIELD_PERF) return null;
  return `verify ms: ${stats(verifyTimes)}\nscan ms: ${stats(scanTimes)}\ncam reads/s: ${cameraRate()}`;
}
